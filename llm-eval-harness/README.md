# tutorial-llm-eval-harness

A small harness for benchmarking cheap LLMs on a structured-output task before you switch models.

The task: a reader describes a book they half remember, the model returns up to five `{title, author}` candidates as strict JSON, and the harness checks whether the right book is among them. It is a miniature of the eval behind [WhatIsThatBook](https://whatisthatbook.com), written up in [Benchmarking cheap LLMs before you switch models](https://segbedji.com/benchmarking-cheap-llms-before-you-switch-models/).

What it does:

- reads cases from `cases/books.jsonl` (16 public-domain books, OpenLibrary work IDs checked)
- calls any OpenRouter model with a **strict** JSON schema, and refuses to start if the schema isn't strict-compatible
- resolves each candidate to an OpenLibrary work ID and scores **P@1, P@5 and MRR**
- tracks cost per call and stops at a **hard spend cap**, reserving each call's worst case before it starts
- counts answerable cases where the model returned nothing, which P@1 alone hides
- exits non-zero when a model regresses against a saved baseline, so CI can block the change

## Quick start (no API key)

```bash
bun install
bun run validate
bun test
bun src/cli.ts --mock --model mock/steady --save-baseline
bun src/cli.ts --mock --model mock/bargain --baseline runs/baseline.json
bun src/cli.ts --mock --model mock/cautious --baseline runs/baseline.json
```

The last two runs fail the gate on purpose. `mock/bargain` is cheap, gets the easy books, misses the rest, guesses on vague queries and truncates one response. `mock/cautious` matches the baseline's P@1 but returns no books on the hard cases, which only the empty-answer check catches.

## Live runs

```bash
export OPENROUTER_API_KEY=...
bun src/cli.ts --model google/gemini-3-flash-preview --max-cost 0.05 --save-baseline --baseline runs/live-baseline.json
bun src/cli.ts --model openai/gpt-5.4-mini --max-cost 0.05 --baseline runs/live-baseline.json
```

Model IDs change often; check [openrouter.ai/models](https://openrouter.ai/models) for current ones. `--max-cost` is required for live runs. Each call reserves `prompt tokens × prompt price + max_tokens × completion price` at the most expensive listed endpoint for the model, so the cap holds even if every call runs to `max_tokens`. A failed call keeps its whole reservation as spent, because you can't always tell what it was billed.

## Options

| Flag | Default | |
| --- | --- | --- |
| `--model` | (required) | OpenRouter model ID, or `mock/steady`, `mock/bargain` or `mock/cautious` with `--mock` |
| `--mock` | off | Use the offline mock provider |
| `--max-cost` | required live, `1` mock | Hard cap in USD |
| `--max-tokens` | `1500` | Per-call output limit (reasoning tokens count against it) |
| `--concurrency` | `4` | Parallel calls |
| `--only` | all | Comma-separated case IDs |
| `--schema` | `strict` | `loose` reproduces the optional-field schema strict mode rejects |
| `--skip-preflight` | off | Send the schema even if it fails the strict-mode check |
| `--resolver` | `local` | `local` reads `catalog/openlibrary-snapshot.json`; `openlibrary` calls the live search API with a disk cache |
| `--baseline` | none | Baseline report to compare against |
| `--save-baseline` | off | Write this run as the baseline instead of gating |
| `--max-p1-drop` | `0.05` | Allowed P@1 drop versus the baseline |
| `--min-p1` | none | Absolute P@1 floor |
| `--max-failures` | `0` | Allowed failed calls |
| `--max-empty-rate` | `0.1` | Allowed share of answerable cases where the model returned no books |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Gate passed (or baseline saved) |
| 1 | Gate failed: too many failures, too many empty answers, or P@1 dropped too far |
| 2 | Spend cap reached; some cases were not run, so the scores are incomplete |
| 3 | Configuration error: no key, no `--max-cost`, unknown schema, schema not strict-compatible |

## Files

```
cases/books.jsonl                  fixture: query, expected book, acceptable work IDs, difficulty, answerable
catalog/openlibrary-snapshot.json  committed title+author → work ID map for repeatable resolution
src/schema.ts                      strict and loose schemas, strict-mode checker, response parser
src/budget.ts                      worst-case reservations and the hard cap
src/runner.ts                      the eval loop
src/score.ts                       P@1, P@5, MRR, abstentions
src/gate.ts                        baseline comparison and exit codes
src/providers/                     OpenRouter and mock providers
src/cli.ts                         command-line entry point
scripts/validate-cases.ts          fixture checks; --online verifies every work ID on OpenLibrary
scripts/build-catalog.ts           rebuilds the catalog snapshot from OpenLibrary search
```

## Limits

Sixteen cases is enough to show the mechanics, not to choose a model. One case moves P@1 by about seven points. The catalog snapshot takes OpenLibrary's top search hit, which can be a duplicate work; that's why each case lists every acceptable work ID instead of one.
