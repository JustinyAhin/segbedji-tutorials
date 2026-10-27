import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Turns a model's {title, author} into an OpenLibrary work ID, so scoring compares IDs instead of strings.
 * `local` reads a committed snapshot and never touches the network, which keeps runs repeatable.
 * `openlibrary` asks the live search API and caches every answer on disk.
 */
export type Resolver = (title: string, author: string) => Promise<string | null>;

export const normalizeTitle = (title: string) =>
	title
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.split(/[:;(]/)[0]!
		.replace(/[^a-z0-9 ]/g, ' ')
		.replace(/^(the|a|an) /, '')
		.replace(/\s+/g, ' ')
		.trim();

export const authorSurname = (author: string) =>
	author
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z ]/g, ' ')
		.trim()
		.split(/\s+/)
		.at(-1) ?? '';

export const catalogKey = (title: string, author: string) => `${normalizeTitle(title)}|${authorSurname(author)}`;

export type CatalogSnapshot = { builtAt: string; entries: Record<string, string> };

export const createLocalResolver = async (path: string): Promise<Resolver> => {
	const snapshot = JSON.parse(await readFile(path, 'utf8')) as CatalogSnapshot;
	return async (title, author) => snapshot.entries[catalogKey(title, author)] ?? null;
};

export const searchOpenLibrary = async (title: string, author: string): Promise<string | null> => {
	const url = new URL('https://openlibrary.org/search.json');
	url.searchParams.set('title', title);
	url.searchParams.set('author', author);
	url.searchParams.set('fields', 'key');
	url.searchParams.set('limit', '1');
	const response = await fetch(url, {
		headers: { 'User-Agent': 'tutorial-llm-eval-harness (example project)' },
		signal: AbortSignal.timeout(20_000)
	});
	if (!response.ok) throw new Error(`OpenLibrary search failed: HTTP ${response.status}`);
	const body = (await response.json()) as { docs?: { key?: string }[] };
	const key = body.docs?.[0]?.key;
	return key ? key.replace('/works/', '') : null;
};

export const createOpenLibraryResolver = async (cacheDir: string): Promise<Resolver> => {
	await mkdir(cacheDir, { recursive: true });
	return async (title, author) => {
		const file = join(cacheDir, `${createHash('sha256').update(catalogKey(title, author)).digest('hex')}.json`);
		const cached = await readFile(file, 'utf8').catch(() => null);
		if (cached !== null) return (JSON.parse(cached) as { workId: string | null }).workId;
		const workId = await searchOpenLibrary(title, author);
		await writeFile(file, JSON.stringify({ title, author, workId }));
		return workId;
	};
};
