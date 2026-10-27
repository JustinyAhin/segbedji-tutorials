import { searchBooks } from '$lib/server/search';

export const load = ({ url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	return { query, results: query ? searchBooks({ query, limit: 5 }) : [] };
};
