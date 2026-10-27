# tutorial-mcp-search

Companion code for the post "Adding an MCP server to an existing search app".

A tiny SvelteKit book finder over 42 public-domain books (Project Gutenberg ids,
summaries written for this repo). The website search and the MCP endpoint share
`src/lib/server/search.ts`. The MCP endpoint is a stateless Streamable HTTP
route at `/mcp` with two tools:

- `find_book`: description (10–2000 chars) → up to 10 candidates
- `get_book`: id → summary, subjects, and source link

No API keys, no database, no LLM. The search is keyword scoring, on purpose:
the post is about the MCP layer, not about search quality.

## Run it

```sh
bun install
bun run dev          # http://localhost:5317, MCP at /mcp
bun run check:mcp    # scripted SDK client checks against the dev server
```

Production build on the Workers runtime, locally:

```sh
cp .dev.vars.example .dev.vars
bun run build
bun run preview      # wrangler dev on http://localhost:8787
bun run check:mcp http://localhost:8787/mcp
```

MCP Inspector (UI): `bun run inspector`, pick Streamable HTTP, enter
`http://localhost:5317/mcp`. Inspector's own origin (`http://localhost:6274`)
is allowed in dev.

## Files

| File | What it does |
| --- | --- |
| `src/lib/server/search.ts` | The existing search. Knows nothing about MCP. |
| `src/routes/+page.server.ts` | The website's use of it. |
| `src/lib/server/mcp/server.ts` | Tool schemas, handlers, transport, host/origin guard. |
| `src/lib/server/mcp/limits.ts` | In-memory rate limit. Not safe across Worker isolates. |
| `src/routes/mcp/+server.ts` | SvelteKit wiring: POST only, GET/DELETE 405. |
| `scripts/check-mcp.ts` | 11 protocol checks with the official SDK client. |
| `plugin/` | Manifests for ChatGPT (`plugin.json`, `mcp.json`) and Claude Code (`.claude-plugin/`, `.mcp.json`). Placeholder URL. |

Nothing here is deployed. Replace `books.example.com` before you deploy.
