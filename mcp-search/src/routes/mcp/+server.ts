import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { checkSearchLimit } from '$lib/server/mcp/limits';
import { handleBookMcpRequest } from '$lib/server/mcp/server';
import { getBook, searchBooks } from '$lib/server/search';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	// Your deployed hostname, e.g. books.example.com. Never allow every host.
	const PRODUCTION_HOST = env.MCP_ALLOWED_HOST ?? 'books.example.com';
	const clientAddress = event.getClientAddress();
	return handleBookMcpRequest({
		request: event.request,
		allowedHosts: dev ? [event.url.host] : [PRODUCTION_HOST],
		allowedOrigins: [
			`https://${PRODUCTION_HOST}`,
			'https://chatgpt.com',
			'https://chat.openai.com',
			'https://claude.ai',
			...(dev ? [event.url.origin, 'http://localhost:6274'] : [])
		],
		search: searchBooks,
		getBook,
		checkLimit: () => checkSearchLimit({ clientAddress }),
		onToolCall: (metric) => console.log('mcp_tool_called', JSON.stringify(metric))
	});
};

const notAllowed: RequestHandler = () =>
	new Response('Use MCP Streamable HTTP POST requests.', { status: 405, headers: { Allow: 'POST' } });

export const GET = notAllowed;
export const DELETE = notAllowed;
