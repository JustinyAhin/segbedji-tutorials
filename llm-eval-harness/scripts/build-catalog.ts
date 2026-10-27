/**
 * Builds catalog/openlibrary-snapshot.json: a small, committed title+author → work ID map.
 * The local resolver reads it so eval runs don't depend on OpenLibrary being up or fast.
 *
 * It resolves every expected answer in the fixture plus the extra titles below.
 * In a real project, feed it every title your models have ever returned.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { catalogKey, searchOpenLibrary, type CatalogSnapshot } from '../src/resolver';
import type { EvalCase } from '../src/types';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');

const extra: [string, string][] = [
	['Jane Eyre', 'Charlotte Brontë'],
	['The Island of Doctor Moreau', 'H. G. Wells'],
	['Treasure Island', 'Robert Louis Stevenson'],
	['The Invisible Man', 'H. G. Wells'],
	['Little Women', 'Louisa May Alcott'],
	['The Strange Case of Dr. Jekyll and Mr. Hyde', 'Robert Louis Stevenson'],
	['Carmilla', 'Joseph Sheridan Le Fanu'],
	["Alice's Adventures in Wonderland", 'Lewis Carroll'],
	['The Turn of the Screw', 'Henry James'],
	['White Fang', 'Jack London'],
	['Great Expectations', 'Charles Dickens']
];

const cases = (await readFile(join(root, 'cases/books.jsonl'), 'utf8'))
	.split('\n')
	.filter((line) => line.trim())
	.map((line) => JSON.parse(line) as EvalCase);

const books: [string, string][] = [
	...cases.flatMap((c) => (c.expected ? [[c.expected.title, c.expected.author] as [string, string]] : [])),
	...extra
];

const entries: Record<string, string> = {};
for (const [title, author] of books) {
	const workId = await searchOpenLibrary(title, author);
	console.log(`${workId ? '✓' : '✗'} ${title} — ${author}: ${workId ?? 'not found'}`);
	if (workId) entries[catalogKey(title, author)] = workId;
}

const snapshot: CatalogSnapshot = { builtAt: new Date().toISOString(), entries };
await writeFile(join(root, 'catalog/openlibrary-snapshot.json'), JSON.stringify(snapshot, null, '\t') + '\n');
console.log(`Wrote ${Object.keys(entries).length} entries`);
