/**
 * Checks every case before it can affect a score:
 * - required fields and types
 * - unique IDs
 * - answerable cases have at least one work ID, unanswerable ones have none
 * - with --online, each work ID exists on OpenLibrary and is a work, not a redirect
 *
 * Exits non-zero on the first broken fixture, so a typo in a work ID fails the PR.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { EvalCase } from '../src/types';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const online = process.argv.includes('--online');
const path = process.argv.find((arg) => arg.endsWith('.jsonl')) ?? join(root, 'cases/books.jsonl');

const lines = (await readFile(path, 'utf8')).split('\n').filter((line) => line.trim());
const errors: string[] = [];
const seen = new Set<string>();
const cases: EvalCase[] = [];

lines.forEach((line, index) => {
	let c: EvalCase;
	try {
		c = JSON.parse(line) as EvalCase;
	} catch {
		errors.push(`line ${index + 1}: not valid JSON`);
		return;
	}
	const where = `${c.id ?? `line ${index + 1}`}`;
	if (typeof c.id !== 'string' || !c.id) errors.push(`${where}: missing id`);
	if (seen.has(c.id)) errors.push(`${where}: duplicate id`);
	seen.add(c.id);
	if (typeof c.query !== 'string' || c.query.length < 10) errors.push(`${where}: query is missing or too short`);
	if (!['easy', 'medium', 'hard'].includes(c.difficulty)) errors.push(`${where}: bad difficulty`);
	if (!Array.isArray(c.acceptable_work_ids)) errors.push(`${where}: acceptable_work_ids must be an array`);
	else if (!c.acceptable_work_ids.every((id) => /^OL\d+W$/.test(id))) errors.push(`${where}: malformed work ID`);
	if (c.answerable && (!c.expected || !c.acceptable_work_ids?.length)) errors.push(`${where}: answerable case needs expected + work IDs`);
	if (!c.answerable && c.acceptable_work_ids?.length) errors.push(`${where}: unanswerable case should not list work IDs`);
	cases.push(c);
});

if (online && !errors.length) {
	for (const c of cases) {
		for (const id of c.acceptable_work_ids) {
			const response = await fetch(`https://openlibrary.org/works/${id}.json`, {
				headers: { 'User-Agent': 'tutorial-llm-eval-harness (example project)' },
				redirect: 'manual'
			});
			if (response.status !== 200) {
				errors.push(`${c.id}: ${id} returned HTTP ${response.status}`);
				continue;
			}
			const work = (await response.json()) as { type?: { key?: string }; title?: string };
			if (work.type?.key !== '/type/work') errors.push(`${c.id}: ${id} is ${work.type?.key}, not a work`);
			else console.log(`  ✓ ${c.id} ${id} "${work.title}"`);
		}
	}
}

if (errors.length) {
	console.error(`✗ ${errors.length} problem(s) in ${path}:\n  - ${errors.join('\n  - ')}`);
	process.exit(1);
}
console.log(`✓ ${cases.length} cases valid${online ? ' (work IDs checked on OpenLibrary)' : ''}`);
