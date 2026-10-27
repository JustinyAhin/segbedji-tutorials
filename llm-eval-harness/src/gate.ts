import type { Summary } from './score';

export type GateOptions = {
	minP1?: number;
	maxP1Drop?: number;
	maxFailures?: number;
	maxEmptyRate?: number;
};

export type Baseline = { model: string; fixtureHash: string; summary: Summary };

export const EXIT = { pass: 0, gateFailed: 1, budgetExceeded: 2, configError: 3 } as const;

/** Returns the reasons the run should fail CI. An empty list means it passes. */
export const checkGate = (
	summary: Summary,
	fixtureHash: string,
	options: GateOptions,
	baseline?: Baseline
): string[] => {
	const reasons: string[] = [];
	const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

	if (options.maxFailures !== undefined && summary.failures > options.maxFailures) {
		reasons.push(`${summary.failures} failed calls (allowed: ${options.maxFailures})`);
	}
	if (options.maxEmptyRate !== undefined && summary.answerable > 0) {
		const rate = summary.emptyAnswers / summary.answerable;
		if (rate > options.maxEmptyRate) {
			reasons.push(`Returned no books on ${pct(rate)} of answerable cases (allowed: ${pct(options.maxEmptyRate)})`);
		}
	}
	if (options.minP1 !== undefined && summary.p1 < options.minP1) {
		reasons.push(`P@1 ${pct(summary.p1)} is below the floor of ${pct(options.minP1)}`);
	}
	if (baseline) {
		// A baseline scored on different cases says nothing about this run.
		if (baseline.fixtureHash !== fixtureHash) {
			reasons.push('Baseline was scored on a different fixture; re-run the baseline first');
		} else if (options.maxP1Drop !== undefined && baseline.summary.p1 - summary.p1 > options.maxP1Drop) {
			reasons.push(
				`P@1 ${pct(summary.p1)} is ${pct(baseline.summary.p1 - summary.p1)} below ` +
					`${baseline.model}'s ${pct(baseline.summary.p1)} (allowed drop: ${pct(options.maxP1Drop)})`
			);
		}
	}
	return reasons;
};
