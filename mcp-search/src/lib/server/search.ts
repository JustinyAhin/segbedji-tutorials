import books from '$lib/data/books.json';

type Book = {
	id: number;
	title: string;
	author: string;
	year: number;
	subjects: string[];
	summary: string;
};

type SearchHit = Book & { score: number; matched_terms: string[] };

const STOPWORDS = new Set(
	'a an and are as at be book by for from he her his i in is it its of on or she story that the their there they this to was where who with about remember read'.split(
		' '
	)
);

const tokenize = (text: string) =>
	text
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((word) => word.length > 2 && !STOPWORDS.has(word))
		.map((word) => word.replace(/(ies|es|s)$/, (end) => (end === 'ies' ? 'y' : '')));

const scoreBook = (book: Book, terms: string[]): SearchHit => {
	const fields = [
		{ words: new Set(tokenize(book.title)), weight: 3 },
		{ words: new Set(tokenize(book.subjects.join(' '))), weight: 2 },
		{ words: new Set(tokenize(`${book.summary} ${book.author}`)), weight: 1 }
	];
	const matched = terms.filter((term) => fields.some((field) => field.words.has(term)));
	const score = terms.reduce(
		(total, term) =>
			total + fields.reduce((sum, field) => sum + (field.words.has(term) ? field.weight : 0), 0),
		0
	);
	return { ...book, score, matched_terms: matched };
};

// The website and the MCP tool both call this. Neither knows about the other.
const searchBooks = ({ query, limit = 5 }: { query: string; limit?: number }): SearchHit[] => {
	const terms = [...new Set(tokenize(query))];
	if (terms.length === 0) return [];

	return (books as Book[])
		.map((book) => scoreBook(book, terms))
		.filter((hit) => hit.score > 0)
		.sort((a, b) => b.score - a.score || a.year - b.year)
		.slice(0, limit);
};

const getBook = (id: number): Book | undefined => (books as Book[]).find((book) => book.id === id);

export { searchBooks, getBook, type Book, type SearchHit };
