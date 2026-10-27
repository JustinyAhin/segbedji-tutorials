// Scripted check against a running server: `bun run dev`, then `bun run check:mcp`.
// Pass another URL as the first argument to check a deployed endpoint.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.argv[2] ?? 'http://localhost:5317/mcp');
let failures = 0;

const check = (name: string, ok: boolean, detail = '') => {
	if (!ok) failures++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const timed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
	const start = performance.now();
	const result = await fn();
	return [result, Math.round(performance.now() - start)];
};

const client = new Client({ name: 'check-mcp', version: '0.1.0' });
await client.connect(new StreamableHTTPClientTransport(url));
check('initialize', client.getServerVersion()?.name === 'tiny-book-finder');

const { tools } = await client.listTools();
check('tools/list', tools.map((t) => t.name).sort().join() === 'find_book,get_book', tools.map((t) => t.name).join(', '));

const [found, foundMs] = await timed(() =>
	client.callTool({
		name: 'find_book',
		arguments: { description: 'a girl follows a white rabbit down a hole and meets a grinning cat' }
	})
);
const top = (found.structuredContent as { candidates: { id: number; title: string }[] }).candidates[0];
check('find_book returns Alice first', top?.id === 11, `${top?.title}, ${foundMs}ms`);

const [details] = await timed(() => client.callTool({ name: 'get_book', arguments: { id: 11 } }));
check('get_book returns a summary', typeof (details.structuredContent as { summary?: string }).summary === 'string');

const short = await client.callTool({ name: 'find_book', arguments: { description: 'rabbit' } });
check('short input is rejected', short.isError === true);

const missing = await client.callTool({ name: 'get_book', arguments: { id: 999999 } });
check('unknown id is a tool error', missing.isError === true);

const none = await client.callTool({
	name: 'find_book',
	arguments: { description: 'quantum blockchain startup founders pivot' }
});
check('no matches is not an error', !none.isError && (none.structuredContent as { status: string }).status === 'no_matches');

await client.close();

const rpc = (body: unknown, headers: Record<string, string> = {}) =>
	fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});

const listRequest = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
check('unknown origin gets 403', (await rpc(listRequest, { origin: 'https://evil.example' })).status === 403);
check('GET gets 405', (await fetch(url)).status === 405);
const big = await rpc(JSON.stringify({ ...listRequest, params: { pad: 'x'.repeat(20_000) } }));
check('oversized body is refused', big.status === 413, `status ${big.status}`);

// Earlier find_book calls already used part of the 10-per-minute allowance.
const limited = new Client({ name: 'check-mcp-limit', version: '0.1.0' });
await limited.connect(new StreamableHTTPClientTransport(url));
let limitedAt = 0;
for (let i = 1; i <= 12; i++) {
	const result = await limited.callTool({
		name: 'find_book',
		arguments: { description: 'a pirate captain with a hook for a hand' }
	});
	if (result.isError) {
		limitedAt = i;
		break;
	}
}
check('rate limit kicks in', limitedAt > 0, `blocked on extra call ${limitedAt}`);
await limited.close();

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
