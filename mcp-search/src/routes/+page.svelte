<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>Tiny book finder</title></svelte:head>

<main>
	<h1>Tiny book finder</h1>
	<p>Describe a public-domain book you half remember.</p>
	<form method="GET">
		<input name="q" value={data.query} placeholder="a girl follows a rabbit down a hole" />
		<button>Search</button>
	</form>

	{#if data.query && data.results.length === 0}
		<p>No matches. Add a character, a place, or an object you remember.</p>
	{/if}

	<ol>
		{#each data.results as book (book.id)}
			<li>
				<a href="https://www.gutenberg.org/ebooks/{book.id}">{book.title}</a>
				by {book.author} ({book.year})
				<small>matched: {book.matched_terms.join(', ')}</small>
			</li>
		{/each}
	</ol>
</main>

<style>
	main {
		max-width: 40rem;
		margin: 3rem auto;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
	}
	input {
		width: 70%;
		padding: 0.4rem;
	}
	small {
		display: block;
		color: #666;
	}
</style>
