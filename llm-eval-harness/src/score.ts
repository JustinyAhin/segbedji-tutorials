import type { CaseResult, Difficulty } from './types';

// 1-based rank of the first resolved work ID that the case accepts. 0 means no hit.
export const firstHitRank = (resolvedWorkIds: (string | null)[], acceptable: string[]): number => {
	const accepted = new Set(acceptable);
	const index = resolvedWorkIds.findIndex((id) => id !== null && accepted.has(id));
	return index === -1 ? 0 : index + 1;
};

export type Summary = {
	cases: number;
	answerable: number;
	failures: number;
	skipped: number;
	p1: number;
	p5: number;
	mrr: number;
	// Answerable cases where the model returned no books at all. P@1 can't tell
	// "guessed wrong" from "didn't guess", and the second one looks very different in production.
	emptyAnswers: number;
	// Unanswerable cases where the model returned no books. Guessing on "the one about the guy" is a miss.
	correctAbstentions: number;
	unanswerable: number;
	costUsd: number;
	unbilledCalls: number;
	byDifficulty: Record<Difficulty, { cases: number; p1: number; p5: number }>;
};

const ratio = (count: number, total: number) => (total === 0 ? 0 : count / total);

/**
 * P@1, P@5 and MRR are computed over answerable cases only, and errors count as misses.
 * Dropping failed calls from the denominator is the easiest way to flatter a flaky model.
 */
export const summarize = (results: CaseResult[]): Summary => {
	const ran = results.filter((r) => r.status !== 'skipped');
	const answerable = ran.filter((r) => r.answerable);
	const unanswerable = ran.filter((r) => !r.answerable);
	const hitsAt = (rows: CaseResult[], k: number) => rows.filter((r) => r.rank > 0 && r.rank <= k).length;

	const byDifficulty = {} as Summary['byDifficulty'];
	for (const difficulty of ['easy', 'medium', 'hard'] as const) {
		const rows = answerable.filter((r) => r.difficulty === difficulty);
		byDifficulty[difficulty] = {
			cases: rows.length,
			p1: ratio(hitsAt(rows, 1), rows.length),
			p5: ratio(hitsAt(rows, 5), rows.length)
		};
	}

	return {
		cases: results.length,
		answerable: answerable.length,
		failures: ran.filter((r) => r.status === 'error').length,
		skipped: results.length - ran.length,
		p1: ratio(hitsAt(answerable, 1), answerable.length),
		p5: ratio(hitsAt(answerable, 5), answerable.length),
		mrr: ratio(
			answerable.reduce((sum, r) => sum + (r.rank > 0 ? 1 / r.rank : 0), 0),
			answerable.length
		),
		emptyAnswers: answerable.filter((r) => r.status === 'ok' && r.abstained).length,
		correctAbstentions: unanswerable.filter((r) => r.status === 'ok' && r.abstained).length,
		unanswerable: unanswerable.length,
		costUsd: ran.reduce((sum, r) => sum + r.costUsd, 0),
		unbilledCalls: ran.filter((r) => r.costSource !== 'billed').length,
		byDifficulty
	};
};
