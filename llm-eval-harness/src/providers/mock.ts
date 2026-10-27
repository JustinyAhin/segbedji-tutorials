import { estimatePromptTokens } from '../budget';
import { strictModeProblems } from '../schema';
import type { CompletionRequest, CompletionResult, EvalCase, Prices, Provider } from '../types';

/**
 * A deterministic stand-in for OpenRouter, so the harness runs without a key and in CI.
 * It knows the fixture's answers and behaves like two very different models:
 *
 * - mock/steady: usually right, a bit pricier, abstains on vague queries
 * - mock/bargain: cheap, right on easy cases only, guesses on vague queries,
 *   truncates one response, and leaves one call unbilled
 * - mock/cautious: cheap, as accurate as steady at rank 1, but returns no books
 *   on hard cases instead of guessing
 *
 * Like OpenAI's strict mode, it rejects any schema that isn't strict-compatible.
 */

type Book = [title: string, author: string];

// A wrong-but-real book per case, so misses still resolve in the catalog.
const distractors: Record<string, Book[]> = {
	'case-001': [['Jane Eyre', 'Charlotte Brontë']],
	'case-002': [['The Island of Doctor Moreau', 'H. G. Wells']],
	'case-003': [['Treasure Island', 'Robert Louis Stevenson']],
	'case-004': [['The Invisible Man', 'H. G. Wells']],
	'case-005': [['Little Women', 'Louisa May Alcott']],
	'case-006': [['The Strange Case of Dr. Jekyll and Mr. Hyde', 'Robert Louis Stevenson']],
	'case-007': [['Carmilla', 'Joseph Sheridan Le Fanu']],
	'case-008': [['Little Women', 'Louisa May Alcott']],
	'case-009': [['The Invisible Man', 'H. G. Wells']],
	'case-010': [["Alice's Adventures in Wonderland", 'Lewis Carroll']],
	'case-011': [['The Turn of the Screw', 'Henry James']],
	'case-012': [['White Fang', 'Jack London']],
	'case-013': [["Alice's Adventures in Wonderland", 'Lewis Carroll']],
	'case-014': [['The Picture of Dorian Gray', 'Oscar Wilde']]
};

const prices: Record<string, Prices> = {
	'mock/steady': { prompt: 0.5 / 1e6, completion: 3 / 1e6 },
	'mock/bargain': { prompt: 0.05 / 1e6, completion: 0.25 / 1e6 },
	'mock/cautious': { prompt: 0.05 / 1e6, completion: 0.25 / 1e6 }
};

const rec = ([title, author]: Book, confidence: 'high' | 'medium' | 'low') => ({
	title,
	author,
	confidence,
	published_before: null
});

const answer = (model: string, c: EvalCase): { body: object; truncated?: boolean; unbilled?: boolean } => {
	const correct: Book | null = c.expected ? [c.expected.title, c.expected.author] : null;
	const wrong = distractors[c.id]?.[0] ?? ['Great Expectations', 'Charles Dickens'];
	const vague = { recommendations: [], clarifying_questions: ['Do you remember anything about the plot?'] };

	if (model === 'mock/steady') {
		if (!correct) return { body: vague };
		const ordered = c.difficulty === 'hard' ? [rec(wrong, 'medium'), rec(correct, 'medium')] : [rec(correct, 'high'), rec(wrong, 'low')];
		return { body: { recommendations: ordered, clarifying_questions: [] } };
	}

	if (model === 'mock/cautious') {
		if (!correct || c.difficulty === 'hard') return { body: vague };
		return { body: { recommendations: [rec(correct, 'high')], clarifying_questions: [] } };
	}

	// mock/bargain
	if (c.id === 'case-007') return { body: {}, truncated: true };
	if (!correct) return { body: { recommendations: [rec(wrong, 'low')], clarifying_questions: [] } };
	const hit = c.difficulty === 'easy';
	return {
		body: { recommendations: [hit ? rec(correct, 'high') : rec(wrong, 'medium')], clarifying_questions: [] },
		unbilled: c.id === 'case-010'
	};
};

export const createMockProvider = ({ cases }: { cases: EvalCase[] }): Provider => {
	const byQuery = new Map(cases.map((c) => [c.query, c]));
	return {
		name: 'mock',
		async getPrices(model) {
			const found = prices[model];
			if (!found) throw new Error(`Unknown mock model "${model}". Try mock/steady, mock/bargain or mock/cautious.`);
			return found;
		},
		async complete(request: CompletionRequest): Promise<CompletionResult> {
			const problems = strictModeProblems(request.schema);
			if (problems.length) {
				throw new Error(`HTTP 400: Invalid schema for response_format '${request.schemaName}': ${problems[0]}`);
			}
			const c = byQuery.get(request.user);
			const { body, truncated, unbilled } = c
				? answer(request.model, c)
				: { body: { recommendations: [], clarifying_questions: [] } };
			if (truncated) throw new Error('Output truncated at max_tokens');
			const content = JSON.stringify(body);
			const usage = {
				promptTokens: estimatePromptTokens(request.system + request.user),
				completionTokens: estimatePromptTokens(content)
			};
			const p = prices[request.model]!;
			return {
				content,
				usage: {
					...usage,
					costUsd: unbilled ? null : usage.promptTokens * p.prompt + usage.completionTokens * p.completion
				}
			};
		}
	};
};
