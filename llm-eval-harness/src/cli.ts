import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Budget } from './budget';
import { checkGate, EXIT, type Baseline } from './gate';
import { createMockProvider } from './providers/mock';
import { createOpenRouterProvider } from './providers/openrouter';
import { createLocalResolver, createOpenLibraryResolver } from './resolver';
import { runEval } from './runner';
import { schemas, strictModeProblems, type SchemaName } from './schema';
import { summarize } from './score';
import type { EvalCase } from './types';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');

const fail = (message: string): never => {
	console.error(`\n✗ ${message}`);
	process.exit(EXIT.configError);
};

const { values: args } = parseArgs({
	options: {
		model: { type: 'string' },
		mock: { type: 'boolean', default: false },
		cases: { type: 'string', default: join(root, 'cases/books.jsonl') },
		only: { type: 'string' },
		'max-cost': { type: 'string' },
		'max-tokens': { type: 'string', default: '1500' },
		concurrency: { type: 'string', default: '4' },
		schema: { type: 'string', default: 'strict' },
		resolver: { type: 'string', default: 'local' },
		baseline: { type: 'string' },
		'save-baseline': { type: 'boolean', default: false },
		'skip-preflight': { type: 'boolean', default: false },
		'min-p1': { type: 'string' },
		'max-p1-drop': { type: 'string', default: '0.05' },
		'max-failures': { type: 'string', default: '0' },
		'max-empty-rate': { type: 'string', default: '0.1' },
		out: { type: 'string', default: join(root, 'runs') }
	}
});

const model = args.model ?? fail('Pass --model, e.g. --model openai/gpt-5.4-mini or --mock --model mock/steady');
const schemaName = args.schema as SchemaName;
const schema = schemas[schemaName] ?? fail(`Unknown --schema ${args.schema}; use strict or loose`);

const fixtureText = await readFile(args.cases, 'utf8');
const fixtureHash = createHash('sha256').update(fixtureText).digest('hex');
const allCases = fixtureText
	.split('\n')
	.filter((line) => line.trim())
	.map((line) => JSON.parse(line) as EvalCase);
const only = args.only?.split(',').map((id) => id.trim());
const cases = only ? allCases.filter((c) => only.includes(c.id)) : allCases;
if (!cases.length) fail('No cases selected');

// Without a key, refuse to guess: either run the mock or stop.
const apiKey = process.env.OPENROUTER_API_KEY;
if (!args.mock && !apiKey) fail('OPENROUTER_API_KEY is not set. Use --mock to run without one.');
if (!args.mock && args['max-cost'] === undefined) fail('Live runs need an explicit --max-cost in USD, e.g. --max-cost 0.05');
const budget = new Budget(Number(args['max-cost'] ?? '1'));

// A schema that strict mode will reject fails here, before it costs anything.
const problems = strictModeProblems(schema);
if (problems.length && !args['skip-preflight']) {
	fail(`The "${schemaName}" schema is not strict-mode compatible:\n  - ${problems.join('\n  - ')}`);
}

const provider = args.mock ? createMockProvider({ cases: allCases }) : createOpenRouterProvider({ apiKey: apiKey! });
const resolver =
	args.resolver === 'openlibrary'
		? await createOpenLibraryResolver(join(root, '.cache/openlibrary'))
		: await createLocalResolver(join(root, 'catalog/openlibrary-snapshot.json'));
const systemPrompt = await readFile(join(root, 'src/prompt.md'), 'utf8');

console.log(`${provider.name} · ${model} · ${cases.length} cases · cap $${budget.capUsd}`);

const { prices, results, budgetError } = await runEval({
	provider,
	resolver,
	model,
	cases,
	systemPrompt,
	schema,
	maxTokens: Number(args['max-tokens']),
	concurrency: Number(args.concurrency),
	budget,
	onResult: (r) => {
		const mark = r.status === 'error' ? '✗' : r.rank === 1 ? '●' : r.rank > 0 ? '◐' : '○';
		const detail = r.status === 'error' ? r.error : r.answerable ? (r.abstained ? 'no books' : `rank ${r.rank || '-'}`) : r.abstained ? 'abstained' : 'guessed';
		console.log(`  ${mark} ${r.id} ${detail}  $${r.costUsd.toFixed(6)}${r.costSource === 'estimated' ? ' (est.)' : ''}`);
	}
});

const summary = summarize(results);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
console.log(
	`\nP@1 ${pct(summary.p1)}  P@5 ${pct(summary.p5)}  MRR ${summary.mrr.toFixed(3)}  ` +
		`(${summary.answerable} answerable, ${summary.failures} failed)`
);
console.log(`No books on ${summary.emptyAnswers}/${summary.answerable} answerable cases`);
console.log(`Abstained correctly on ${summary.correctAbstentions}/${summary.unanswerable} vague queries`);
console.log(`Spent $${summary.costUsd.toFixed(6)} (${summary.unbilledCalls} calls estimated, not billed)`);

const report = { model, provider: provider.name, schema: schemaName, fixtureHash, prices, createdAt: new Date().toISOString(), summary, results };
await mkdir(args.out, { recursive: true });
const reportPath = join(args.out, `${model.replace(/[^a-z0-9.-]+/gi, '_')}.json`);
await writeFile(reportPath, JSON.stringify(report, null, '\t'));
console.log(`Report: ${reportPath}`);

if (budgetError) {
	console.error(`\n✗ Stopped at the spend cap: ${budgetError.message}`);
	console.error(`  ${summary.skipped} cases were not run. Treat this as an incomplete run, not a score.`);
	process.exit(EXIT.budgetExceeded);
}

if (args['save-baseline']) {
	const baselinePath = args.baseline ?? join(args.out, 'baseline.json');
	await writeFile(baselinePath, JSON.stringify({ model, fixtureHash, summary } satisfies Baseline, null, '\t'));
	console.log(`Saved baseline: ${baselinePath}`);
	process.exit(EXIT.pass);
}

const baseline = args.baseline
	? (JSON.parse(await readFile(args.baseline, 'utf8')) as Baseline)
	: undefined;
const reasons = checkGate(
	summary,
	fixtureHash,
	{
		minP1: args['min-p1'] === undefined ? undefined : Number(args['min-p1']),
		maxP1Drop: Number(args['max-p1-drop']),
		maxFailures: Number(args['max-failures']),
		maxEmptyRate: Number(args['max-empty-rate'])
	},
	baseline
);

if (reasons.length) {
	console.error(`\n✗ Gate failed:\n  - ${reasons.join('\n  - ')}`);
	process.exit(EXIT.gateFailed);
}
console.log('\n✓ Gate passed');
