# jkai tool-progress emit pattern

Long-running MCP tools can stream incremental progress to the canvas chat
UI by calling `ctx.emit(message)` from inside their handler. The emit
plumbing is already in place — calls flow:

1. Tool handler: `ctx.emit('Fetching page 2/5…')` (src/lib/mcp/jsonrpc.ts:255)
2. MCP plumbing publishes a `tool_step.progress` event on the tool-step
   bus (src/lib/mcp/jsonrpc.ts:255–273 area)
3. Orchestrator chat route subscribes and re-publishes as a `status`
   JobEvent (src/routes/api/workflows/orchestrator/chat/+server.ts)
4. ChatArea.svelte renders the status inline under the running tool row

## Reference implementations

- `src/lib/workflows/nodes/llm-agent.ts:218,229` — existing emit usage
  pattern (passes object literal; tool handlers use a string).
- `src/lib/workflows/site-tools/tools/scraper.ts` — proof-of-concept added
  in Phase 6 of the TTFT optimization pass. The `scraper_script_test`
  handler bridges `runScript`'s `onProgress` callback into `ctx.emit`,
  emitting at each named phase: decompose-start, decompose-done,
  exec-start, and exec-done (with item count or error text).

## When to add ctx.emit

Add an emit call at any point where a tool:
- Begins a new network request (per-page, per-API-call)
- Crosses a phase boundary (e.g. "fetched" → "parsing" → "extracting")
- Reaches a meaningful checkpoint in a loop (every 5 items, etc.)

Avoid emitting on trivial operations (sub-millisecond steps) — the user
won't notice, and excessive emits add visual noise.

## How ctx is wired

`ctx` is optional (`ctx?: ToolExecContext`) — always guard before calling:

```typescript
if (ctx?.emit) ctx.emit('Starting phase 2…');
```

The `ToolExecContext` interface (src/lib/workflows/site-tools/registry-internal.ts):

```typescript
export interface ToolExecContext {
  emit: (text: string) => void;   // <-- single string; no object literals
  jobId?: string;
  conversationId?: string;
}
```

`emit` is injected by the MCP plumbing in `src/lib/mcp/jsonrpc.ts:249–273`
when a tool is called via the `/mcp` endpoint. Tools invoked directly (e.g.
in unit tests or workflow nodes that call `executeTool`) receive `undefined`
for `ctx`, which is why the guard is required.

## Tools that should emit progress (checklist)

The following MCP-reachable tools take >2s in common cases and would
benefit from progress emissions. (Inventory taken during Phase 6 of the
TTFT pass; revisit when adding new tools.)

- [x] `scraper_script_test` — Playwright headless run, 5–30 s; wired in Phase 6
- [ ] `file_read` (audio/video) — Whisper transcription can take 30–120 s for
      large files; emit after upload, after each chunk if chunked, on done
- [ ] `generate_image` (count > 1) — sequential OpenRouter FLUX calls;
      emit "Generating image N/M…" per iteration in the `for` loop
- [ ] `gmail_search` (large max) — batch of parallel `fetchMessage` calls;
      emit "Fetching N messages…" before the `Promise.all` and on completion
- [ ] `research_extract` / `research_query` — single LLM call that can take
      3–8 s; emit "Querying research findings…" before the `completions.create`
