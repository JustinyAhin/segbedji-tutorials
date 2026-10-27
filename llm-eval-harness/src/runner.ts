import { Budget, BudgetExceededError, costFromUsage, estimatePromptTokens, worstCaseCost } from './budget';
import { parseResponse } from './schema';
import { firstHitRank } from './score';
import type { Resolver } from './resolver';
import type { CaseResult, EvalCase, JsonSchema, Provider } from './types';

export type RunOptions = {
	provider: Provider;
	resolver: Resolver;
	model: string;
	cases: EvalCase[];
	systemPrompt: string;
	schema: JsonSchema;
	maxTokens: number;
	concurrency: number;
	budget: Budget;
	onResult?: (result: CaseResult) => void;
};

const blank = (c: EvalCase): CaseResult => ({
	id: c.id,
	difficulty: c.difficulty,
	answerable: c.answerable,
	status: 'skipped',
	recommendations: [],
	resolvedWorkIds: [],
	rank: 0,
	abstained: false,
	costUsd: 0,
	costSource: 'none',
	latencyMs: 0
});

export const runEval = async (options: RunOptions) => {
	const { provider, resolver, model, cases, systemPrompt, schema, maxTokens, budget } = options;
	const prices = await provider.getPrices(model);
	const results = cases.map(blank);
	let budgetError: BudgetExceededError | null = null;
	let next = 0;

	const runCase = async (index: number) => {
		const c = cases[index]!;
		const result = results[index]!;

		// Reserve the worst case before calling. If it doesn't fit, this case and the rest are skipped.
		const ceiling = worstCaseCost(prices, estimatePromptTokens(systemPrompt + c.query), maxTokens);
		const reservation = budget.reserve(ceiling);

		const started = performance.now();
		try {
			const { content, usage } = await provider.complete({
				model,
				system: systemPrompt,
				user: c.query,
				maxTokens,
				schema,
				schemaName: 'book_search'
			});
			result.costUsd = usage.costUsd ?? costFromUsage(prices, usage);
			result.costSource = usage.costUsd === null ? 'estimated' : 'billed';
			reservation.settle(result.costUsd);

			const parsed = parseResponse(content);
			result.recommendations = parsed.recommendations;
			result.abstained = parsed.recommendations.length === 0;
			result.resolvedWorkIds = await Promise.all(parsed.recommendations.map((r) => resolver(r.title, r.author)));
			result.rank = firstHitRank(result.resolvedWorkIds, c.acceptable_work_ids);
			result.status = 'ok';
		} catch (error) {
			// We don't know what a failed call cost, so keep the whole reservation as spent.
			if (result.costSource === 'none') {
				result.costUsd = ceiling;
				result.costSource = 'estimated';
				reservation.settle(ceiling);
			}
			result.status = 'error';
			result.error = error instanceof Error ? error.message : String(error);
		} finally {
			result.latencyMs = Math.round(performance.now() - started);
		}
		options.onResult?.(result);
	};

	const worker = async () => {
		while (!budgetError && next < cases.length) {
			const index = next++;
			try {
				await runCase(index);
			} catch (error) {
				if (!(error instanceof BudgetExceededError)) throw error;
				budgetError = error;
			}
		}
	};

	await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
	return { prices, results, budgetError: budgetError as BudgetExceededError | null };
};
