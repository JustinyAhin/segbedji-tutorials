import { describe, expect, test } from 'bun:test';
import { Budget, BudgetExceededError } from '../src/budget';
import { checkGate } from '../src/gate';
import { catalogKey } from '../src/resolver';
import { looseSchema, parseResponse, strictModeProblems, strictSchema } from '../src/schema';
import { firstHitRank, summarize } from '../src/score';
import type { CaseResult } from '../src/types';

const result = (overrides: Partial<CaseResult>): CaseResult => ({
	id: 'x',
	difficulty: 'easy',
	answerable: true,
	status: 'ok',
	recommendations: [],
	resolvedWorkIds: [],
	rank: 0,
	abstained: false,
	costUsd: 0,
	costSource: 'billed',
	latencyMs: 0,
	...overrides
});

describe('scoring', () => {
	test('rank uses any acceptable work ID', () => {
		expect(firstHitRank(['OL1W', null, 'OL118393W'], ['OL118388W', 'OL118393W'])).toBe(3);
		expect(firstHitRank(['OL1W'], ['OL2W'])).toBe(0);
	});

	test('P@1, P@5 and MRR count errors as misses and ignore unanswerable cases', () => {
		const summary = summarize([
			result({ rank: 1 }),
			result({ rank: 2 }),
			result({ rank: 0 }),
			result({ status: 'error', rank: 0 }),
			result({ answerable: false, abstained: true, rank: 0 })
		]);
		expect(summary.answerable).toBe(4);
		expect(summary.p1).toBe(0.25);
		expect(summary.p5).toBe(0.5);
		expect(summary.mrr).toBeCloseTo((1 + 0.5) / 4);
		expect(summary.failures).toBe(1);
		expect(summary.correctAbstentions).toBe(1);
	});

	test('empty answers on answerable cases are counted separately from wrong guesses', () => {
		const summary = summarize([result({ abstained: true }), result({ rank: 0 }), result({ rank: 1 })]);
		expect(summary.emptyAnswers).toBe(1);
		expect(checkGate(summary, 'h', { maxEmptyRate: 0.2 })[0]).toContain('no books');
	});

	test('skipped cases are excluded from the score and reported', () => {
		const summary = summarize([result({ rank: 1 }), result({ status: 'skipped' })]);
		expect(summary.p1).toBe(1);
		expect(summary.skipped).toBe(1);
	});
});

describe('schema', () => {
	test('the strict schema passes the strict-mode check, the loose one does not', () => {
		expect(strictModeProblems(strictSchema)).toEqual([]);
		expect(strictModeProblems(looseSchema)).toContain('$.recommendations[].published_before is not in "required"');
	});

	test('parseResponse rejects a missing nullable field', () => {
		const ok = { recommendations: [{ title: 'A', author: 'B', confidence: 'high', published_before: null }], clarifying_questions: [] };
		expect(parseResponse(JSON.stringify(ok)).recommendations).toHaveLength(1);
		const missing = { recommendations: [{ title: 'A', author: 'B', confidence: 'high' }], clarifying_questions: [] };
		expect(() => parseResponse(JSON.stringify(missing))).toThrow('published_before is missing');
	});
});

describe('budget', () => {
	test('refuses a call whose worst case does not fit', () => {
		const budget = new Budget(0.01);
		const first = budget.reserve(0.006);
		expect(() => budget.reserve(0.006)).toThrow(BudgetExceededError);
		first.settle(0.001);
		expect(() => budget.reserve(0.006)).not.toThrow();
		expect(budget.spentUsd).toBeCloseTo(0.001);
	});
});

describe('gate', () => {
	const summary = summarize([result({ rank: 1 }), result({ rank: 0 })]);
	test('fails on a P@1 drop beyond the allowance', () => {
		const baseline = { model: 'base', fixtureHash: 'h', summary: summarize([result({ rank: 1 }), result({ rank: 1 })]) };
		expect(checkGate(summary, 'h', { maxP1Drop: 0.05 }, baseline)).toHaveLength(1);
		expect(checkGate(summary, 'h', { maxP1Drop: 0.6 }, baseline)).toHaveLength(0);
	});
	test('refuses to compare against a baseline from another fixture', () => {
		const baseline = { model: 'base', fixtureHash: 'old', summary };
		expect(checkGate(summary, 'new', { maxP1Drop: 1 }, baseline)[0]).toContain('different fixture');
	});
});

describe('resolver keys', () => {
	test('normalize titles, subtitles and accents', () => {
		expect(catalogKey('Frankenstein; or, The Modern Prometheus', 'Mary Shelley')).toBe(catalogKey('Frankenstein', 'mary shelley'));
		expect(catalogKey('Wuthering Heights', 'Emily Brontë')).toBe('wuthering heights|bronte');
	});
});
