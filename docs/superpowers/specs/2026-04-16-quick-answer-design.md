# Quick Answer — Design Spec

**Date:** 2026-04-16
**Goal:** A fast research mode that returns a synthesised 200-500 word answer with inline citations in under 2 minutes. Additive — the existing deepdive pipeline is untouched.

## Input / Output

**Input:** Topic (string) + optional goals (string[]) — same shape as deepdive.
**Output:** Markdown answer with `[1][2]` inline citations, plus a ranked source list with URLs, titles, domains, and credibility scores.

## Pipeline (3 sequential steps)

### Step 1 — Query generation (~2-5s)
Single `jsonCompletion` call. System prompt includes topic + goals. Asks for 3-5 diverse search queries. Stored on the row as `queries`.

### Step 2 — Parallel search (~3-10s)
All queries fired in parallel via `search()` from `$lib/deepdive/tavily.ts`, with `includeAnswer: true` for Tavily's per-query summary. 5 results per query. Results merged, deduped by URL, ranked by `classifyDomain` credibility score * position weight. Top 12 kept. Stored as `sources` JSONB.

### Step 3 — Streaming synthesis (~20-60s)
New `streamCompletion` helper in `$lib/deepdive/ai.ts`. Streams tokens over SSE so the user sees output live. Model: fast tier via OpenRouter (e.g. `anthropic/claude-haiku-4-5` or `google/gemini-2.0-flash-001`). Prompt includes topic, goals, and the 12 source snippets with citation indices. Output stored as `answer` markdown.

## Data Model

New table `quick_answer`, no FKs to existing deepdive tables:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `defaultRandom()` |
| `topic` | text | required |
| `goals` | jsonb (string[]) | default `[]` |
| `status` | text | `pending` / `searching` / `synthesising` / `complete` / `failed` |
| `answer` | text (nullable) | final markdown |
| `sources` | jsonb (QuickAnswerSource[]) | `[{ url, title, domain, credibilityScore, credibilityType, snippet, citationIndex }]` |
| `queries` | jsonb (string[]) | the generated search queries |
| `error_message` | text (nullable) | on failure |
| `tokens_used` | integer (nullable) | synthesis call usage |
| `duration_ms` | integer (nullable) | wall-clock time |
| `created_at` | timestamp w/tz | `defaultNow()` |
| `completed_at` | timestamp w/tz (nullable) | on completion |

Sources are denormalised JSONB rather than FKs to `sources` table — the existing table has deepdive-specific columns (phase, category, sessionId FK) that don't apply here.

## File Structure

### New module: `src/lib/quickanswer/`
- **`types.ts`** — `QuickAnswerSource`, `QuickAnswerSSEEvent` types
- **`worker.ts`** — `runQuickAnswer(id)`, emitter/abort/stop helpers (same pattern as `$lib/deepdive/worker.ts` but much simpler)
- **`prompts.ts`** — query-gen and synthesis prompt templates

### New routes: `src/routes/quickanswer/`
- **`+page.svelte` / `+page.server.ts`** — list of past quick answers + "new" form (topic + optional goals). Submit creates row via server action, redirects to `[id]`.
- **`[id]/+page.svelte` / `+page.server.ts`** — result viewer. If status != complete, connects to SSE stream. Shows: status badge, streaming answer (token-by-token), sources list with credibility chips.
- **`[id]/stream/+server.ts`** — SSE endpoint. On GET: starts `runQuickAnswer(id)` if pending, returns SSE stream.

### Changes to existing files
- **`src/lib/db/schema.ts`** — add `quickAnswers` table definition
- **`src/lib/deepdive/tavily.ts`** — add `includeAnswer?: boolean` to search options, pass `include_answer` in request body, add `answer?: string` to `TavilySearchResponse`
- **`src/lib/deepdive/ai.ts`** — add `streamCompletion()` function: same client/model as `chatCompletion` but with `stream: true`, yields tokens via callback, returns full text

### Navigation
- Add a link to `/quickanswer` from the deepdive page (or wherever makes sense — sibling nav)

## SSE Event Types

```ts
type QuickAnswerSSEEvent =
  | { type: 'log'; message: string }
  | { type: 'status'; data: { status: string } }
  | { type: 'sources'; data: { sources: QuickAnswerSource[] } }
  | { type: 'token'; data: { token: string } }
  | { type: 'complete'; data: { durationMs: number } }
  | { type: 'error'; message: string };
```

Progress flow visible to user:
1. `status: searching` + log messages as queries run
2. `sources` event with the ranked source list (rendered immediately)
3. `status: synthesising` + `token` events (answer streams in live)
4. `status: complete`

## Synthesis Prompt Design

The synthesis prompt instructs the model to:
- Write a 200-500 word answer in clear, factual prose
- Use inline `[N]` citations referencing the numbered source list
- Cite at least 3 sources
- Note conflicting information where sources disagree
- Not fabricate claims beyond what the sources support

## Cancellation

Single AbortController per run. Cancel button on the UI aborts the in-flight step (search or LLM stream). Row status set to `failed` with `error_message: 'Cancelled'`.

## Model Choice

Uses the existing `getOpenAIClient()` / `getModel()` from `$lib/deepdive/keys.ts` for query generation (cheap, fast JSON call). For synthesis streaming, uses `getOpenRouterClient()` with a fast model — start with `anthropic/claude-haiku-4-5`. If OpenRouter key isn't configured, fall back to the Z.AI client.

## What This Does NOT Do

- No facts/entities/relationships tables
- No red teaming
- No embeddings or dedup
- No post-processing or cross-session linking
- No share tokens (could add later)
- No "upgrade to full deepdive" path (could add later by seeding a deepdive session from the sources)
