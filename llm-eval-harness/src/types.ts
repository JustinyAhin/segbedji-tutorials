export type Difficulty = 'easy' | 'medium' | 'hard';

export type EvalCase = {
	id: string;
	query: string;
	expected: { title: string; author: string } | null;
	acceptable_work_ids: string[];
	difficulty: Difficulty;
	answerable: boolean;
};

export type Recommendation = {
	title: string;
	author: string;
	confidence: 'high' | 'medium' | 'low';
	published_before: number | null;
};

export type BookSearchResponse = {
	recommendations: Recommendation[];
	clarifying_questions: string[];
};

export type Usage = {
	promptTokens: number;
	completionTokens: number;
	// What the provider says it billed. OpenRouter returns this when you send `usage: { include: true }`.
	costUsd: number | null;
};

export type Prices = {
	// USD per token, the unit OpenRouter's /models endpoint uses.
	prompt: number;
	completion: number;
};

export type CompletionRequest = {
	model: string;
	system: string;
	user: string;
	maxTokens: number;
	schema: JsonSchema;
	schemaName: string;
};

export type CompletionResult = { content: string; usage: Usage };

export type Provider = {
	name: string;
	getPrices: (model: string) => Promise<Prices>;
	complete: (request: CompletionRequest) => Promise<CompletionResult>;
};

export type JsonSchema = {
	type?: string | string[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
	additionalProperties?: boolean;
	items?: JsonSchema;
	enum?: unknown[];
	maxItems?: number;
	[key: string]: unknown;
};

export type CaseResult = {
	id: string;
	difficulty: Difficulty;
	answerable: boolean;
	status: 'ok' | 'error' | 'skipped';
	error?: string;
	recommendations: Recommendation[];
	resolvedWorkIds: (string | null)[];
	rank: number; // 1-based rank of the first acceptable work; 0 if none
	abstained: boolean;
	costUsd: number;
	costSource: 'billed' | 'estimated' | 'none';
	latencyMs: number;
};
