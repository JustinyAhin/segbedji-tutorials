import type { Prices, Usage } from './types';

export class BudgetExceededError extends Error {}

// Rough and deliberately pessimistic: ~3 characters per token overestimates for English.
export const estimatePromptTokens = (text: string) => Math.ceil(text.length / 3);

/**
 * The most a single call can cost: the whole prompt plus every token `max_tokens` allows.
 * Reasoning tokens are billed as completion tokens and count against max_tokens on OpenRouter,
 * so this ceiling still holds for reasoning models.
 */
export const worstCaseCost = (prices: Prices, promptTokens: number, maxTokens: number) =>
	promptTokens * prices.prompt + maxTokens * prices.completion;

export const costFromUsage = (prices: Prices, usage: Usage) =>
	usage.promptTokens * prices.prompt + usage.completionTokens * prices.completion;

/**
 * A hard spend cap that holds with concurrent calls.
 * Each call reserves its worst case before it starts. The reservation is replaced by the
 * real cost when the call finishes. A call that can't fit its worst case never starts.
 */
export class Budget {
	private spent = 0;
	private reserved = 0;

	constructor(readonly capUsd: number) {
		if (!(capUsd > 0)) throw new Error('Budget cap must be a positive number of dollars');
	}

	reserve(amountUsd: number) {
		if (this.spent + this.reserved + amountUsd > this.capUsd) {
			throw new BudgetExceededError(
				`Next call could cost $${amountUsd.toFixed(6)}; spent $${this.spent.toFixed(6)}, ` +
					`reserved $${this.reserved.toFixed(6)}, cap $${this.capUsd}`
			);
		}
		this.reserved += amountUsd;
		let settled = false;
		return {
			settle: (actualUsd: number) => {
				if (settled) return;
				settled = true;
				this.reserved -= amountUsd;
				this.spent += actualUsd;
			}
		};
	}

	get spentUsd() {
		return this.spent;
	}
}
