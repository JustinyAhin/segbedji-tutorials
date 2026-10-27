import type { CompletionRequest, CompletionResult, Prices, Provider } from '../types';

const BASE_URL = 'https://openrouter.ai/api/v1';

type EndpointPricing = { prompt: string; completion: string };

const toPrices = (pricing: EndpointPricing): Prices => {
	const prices = { prompt: Number(pricing.prompt), completion: Number(pricing.completion) };
	if (![prices.prompt, prices.completion].every((v) => Number.isFinite(v) && v >= 0)) {
		throw new Error(`Unreadable pricing: ${JSON.stringify(pricing)}`);
	}
	return prices;
};

export const createOpenRouterProvider = ({ apiKey }: { apiKey: string }): Provider => ({
	name: 'openrouter',

	// The same model can be served by several providers at different prices.
	// For a spend cap, the most expensive endpoint is the only safe assumption.
	async getPrices(model) {
		const response = await fetch(`${BASE_URL}/models/${model}/endpoints`);
		if (!response.ok) throw new Error(`Could not load prices for ${model}: HTTP ${response.status}`);
		const body = (await response.json()) as { data?: { endpoints?: { pricing: EndpointPricing }[] } };
		const endpoints = body.data?.endpoints ?? [];
		if (!endpoints.length) throw new Error(`No endpoints listed for ${model}`);
		const all = endpoints.map((e) => toPrices(e.pricing));
		return {
			prompt: Math.max(...all.map((p) => p.prompt)),
			completion: Math.max(...all.map((p) => p.completion))
		};
	},

	async complete(request: CompletionRequest): Promise<CompletionResult> {
		const response = await fetch(`${BASE_URL}/chat/completions`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: request.model,
				messages: [
					{ role: 'system', content: request.system },
					{ role: 'user', content: request.user }
				],
				max_tokens: request.maxTokens,
				response_format: {
					type: 'json_schema',
					json_schema: { name: request.schemaName, strict: true, schema: request.schema }
				},
				// Only route to providers that honour response_format, instead of silently ignoring it.
				provider: { require_parameters: true },
				usage: { include: true }
			}),
			signal: AbortSignal.timeout(60_000)
		});
		const body = (await response.json().catch(() => null)) as {
			error?: { message?: string };
			choices?: { finish_reason?: string; message?: { content?: string } }[];
			usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
		} | null;
		if (!response.ok || !body || body.error) {
			throw new Error(`HTTP ${response.status}: ${body?.error?.message ?? 'no body'}`);
		}
		const choice = body.choices?.[0];
		if (choice?.finish_reason === 'length') throw new Error('Output truncated at max_tokens');
		if (typeof choice?.message?.content !== 'string') throw new Error('No response content');
		return {
			content: choice.message.content,
			usage: {
				promptTokens: body.usage?.prompt_tokens ?? 0,
				completionTokens: body.usage?.completion_tokens ?? 0,
				costUsd: typeof body.usage?.cost === 'number' ? body.usage.cost : null
			}
		};
	}
});
