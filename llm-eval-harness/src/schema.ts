import type { BookSearchResponse, JsonSchema, Recommendation } from './types';

// The schema the app actually sends. Every property is listed in `required`,
// optional values are expressed as `null`, and no object accepts extra keys.
// That is what OpenAI's strict structured outputs demand.
export const strictSchema: JsonSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['recommendations', 'clarifying_questions'],
	properties: {
		recommendations: {
			type: 'array',
			maxItems: 5,
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['title', 'author', 'confidence', 'published_before'],
				properties: {
					title: { type: 'string' },
					author: { type: 'string' },
					confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
					published_before: { type: ['integer', 'null'] }
				}
			}
		},
		clarifying_questions: { type: 'array', items: { type: 'string' } }
	}
};

// The kind of schema that works fine with Gemini and quietly breaks the comparison
// with OpenAI models: `published_before` is optional instead of nullable.
export const looseSchema: JsonSchema = {
	type: 'object',
	required: ['recommendations', 'clarifying_questions'],
	properties: {
		recommendations: {
			type: 'array',
			items: {
				type: 'object',
				required: ['title', 'author', 'confidence'],
				properties: {
					title: { type: 'string' },
					author: { type: 'string' },
					confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
					published_before: { type: 'integer' }
				}
			}
		},
		clarifying_questions: { type: 'array', items: { type: 'string' } }
	}
};

export const schemas = { strict: strictSchema, loose: looseSchema } as const;
export type SchemaName = keyof typeof schemas;

/**
 * Returns the problems a strict-mode provider would reject the schema for.
 * Run it before the first paid call, so a bad schema fails the run instead of every case.
 */
export const strictModeProblems = (schema: JsonSchema, path = '$'): string[] => {
	const problems: string[] = [];
	if (schema.properties) {
		const keys = Object.keys(schema.properties);
		const required = new Set(schema.required ?? []);
		for (const key of keys) {
			if (!required.has(key)) problems.push(`${path}.${key} is not in "required"`);
		}
		if (schema.additionalProperties !== false) {
			problems.push(`${path} must set additionalProperties: false`);
		}
		for (const [key, child] of Object.entries(schema.properties)) {
			problems.push(...strictModeProblems(child, `${path}.${key}`));
		}
	}
	if (schema.items) problems.push(...strictModeProblems(schema.items, `${path}[]`));
	return problems;
};

const isString = (value: unknown): value is string => typeof value === 'string';

const parseRecommendation = (value: unknown, index: number): Recommendation => {
	if (!value || typeof value !== 'object') throw new Error(`recommendations[${index}] is not an object`);
	const item = value as Record<string, unknown>;
	if (!isString(item.title) || !isString(item.author)) {
		throw new Error(`recommendations[${index}] is missing title or author`);
	}
	if (item.confidence !== 'high' && item.confidence !== 'medium' && item.confidence !== 'low') {
		throw new Error(`recommendations[${index}].confidence is invalid`);
	}
	if (!('published_before' in item)) {
		throw new Error(`recommendations[${index}].published_before is missing`);
	}
	const publishedBefore = item.published_before;
	if (publishedBefore !== null && !Number.isInteger(publishedBefore)) {
		throw new Error(`recommendations[${index}].published_before is not an integer or null`);
	}
	return {
		title: item.title,
		author: item.author,
		confidence: item.confidence,
		published_before: publishedBefore as number | null
	};
};

// Validates the model's output against what the app needs, not just "is it JSON".
export const parseResponse = (content: string): BookSearchResponse => {
	const parsed: unknown = JSON.parse(content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
	if (!parsed || typeof parsed !== 'object') throw new Error('Response is not an object');
	const data = parsed as Record<string, unknown>;
	if (!Array.isArray(data.recommendations)) throw new Error('recommendations is not an array');
	if (!Array.isArray(data.clarifying_questions) || !data.clarifying_questions.every(isString)) {
		throw new Error('clarifying_questions is not a string array');
	}
	return {
		recommendations: data.recommendations.slice(0, 5).map(parseRecommendation),
		clarifying_questions: data.clarifying_questions
	};
};
