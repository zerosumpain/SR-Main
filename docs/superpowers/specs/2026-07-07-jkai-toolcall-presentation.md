# jkai tool-call thread — categorised, outcome-first presentation

**Date:** 2026-07-07
**Status:** in progress

## Problem

While jkai works a request it materialises its reasoning then a thread of tool
cards. Today that thread is verbose and opaque (see the "avinox stock" transcript):

- **Every jkai tool renders twice.** Hermes fires a `send_tool` frame for the MCP
  call `mcp_jkai_jkai_extended`; the chat route's `isBusServedTool` only recognises
  the un-prefixed `jkai_extended`, so the frame isn't de-duped against the
  in-process tool-step bus. Result: a raw-JSON-blob card ("mcp jkai jkai extended
  `{"result":"{\"success\"...`") **and** a bus card ("jkai extended /
  jkai_extended completed") for the same call.
- **The real sub-tool is masked.** Bus cards carry `tool: 'jkai_extended'` (the
  meta-dispatcher) with the true tool (`web_search`, `fetch_url`, …) + its args
  buried inside the meta args. `summarizeToolResult` therefore falls to its
  `${tool} completed` default → "jkai_extended completed", and even the web_search
  case can't fire because it never sees the inner args.
- **No category, no outcome.** A user can't skim the thread and understand what is
  happening and why.

## Goal (user's spec)

Each line = **one-word CATEGORY** (`WEB`, `TOOL`, …) of the action + **a few-word
summary of the *outcome*** of that action. Technical detail stays, one click away
(the existing args/result disclosure). A user can follow along and understand.

## Design

Single source of truth: **`src/lib/workflows/chat/tool-summary.ts`**. Three
additions consumed by every render path so bus, Hermes-native frames, live cards,
the collapsed drawer and the sub-agent bubble all agree:

1. `resolveDisplayTool(tool, args) → { tool, args }` — unwraps the `jkai_extended`
   meta call (`{operation:'invoke', name, args}`) to the real sub-tool + inner
   args, and strips a leading `mcp_<server>_` namespace. Passthrough otherwise.
2. `categorizeTool(tool) → Category` — deterministic name→category map
   (`WEB FILE MAIL HOME CANVAS DATA MSG AGENT MEM RUN TOOL`).
3. Enhanced `summarizeRunningTool` / `summarizeToolResult`: resolve the display
   tool first; unwrap the `{success,data}` site-tool envelope; broaden coverage so
   the *outcome* is stated (web_search → query + result count + top host; fetch_url
   → page title/host; ha_* → entity/state; render_* → title; the generic default
   becomes a worded outcome, not "`tool` completed").

Resolution happens **at the bus publish sites** (`src/lib/mcp/jsonrpc.ts`) so
`step.tool` / `step.args` reaching the UI (and the persisted `toolSteps` metadata)
are already the real sub-tool. Execution + `busKey` + `_meta` stay on the original
`name`/`args`; only the display tool/args/summary use the resolved value. Both
`started` and `completed`/`failed` publishes resolve identically, so name-based
correlation in `ChatArea` still matches (the bus path also correlates by `stepId`).

De-dupe fix: `isBusServedTool` normalises the `mcp_<server>_` prefix before its
`jkai_extended` / `isRegisteredTool` checks, killing the double render. Genuinely
non-bus Hermes frames (e.g. `terminal`, skills) keep rendering but now go through
`summarizeToolResult` (worded fallback) instead of the raw `previewResult` blob.

UI: a mono uppercase **category chip** leads each step line; the outcome summary
becomes the primary text (falls back to the friendly tool label when a summary is
absent). Colour is restrained + identity-stable (category→token, never rank→hue):
WEB/MAIL/AGENT → `--accent-ink`, RUN → `--accent`, HOME → `--status-success`, rest
neutral `--text-secondary`. Applied to both render sites in `ChatArea.svelte` and
the sub-agent steps in `SubAgentBubble.svelte`.

## Files to touch

- `src/lib/workflows/chat/tool-summary.ts` — resolveDisplayTool + categorizeTool + envelope-unwrap + broadened summaries (core).
- `src/lib/mcp/jsonrpc.ts` — resolve display tool/args for the 3 bus publishes.
- `src/lib/jkai/sse-adapter.ts` — worded fallback via summarizeToolResult + strip mcp prefix for the display tool.
- `src/routes/api/workflows/orchestrator/chat/+server.ts` — normalise mcp prefix in `isBusServedTool`.
- `src/lib/components/jkai/ChatArea.svelte` — category chip + outcome-primary line, both render sites.
- `src/lib/components/jkai/SubAgentBubble.svelte` — category chip on sub-agent steps.

## Verification

1. Pure-function harness replays the exact transcript payloads
   (`jkai_extended` invoke of `web_search` / `fetch_url`, a 403 failure) through
   `resolveDisplayTool` → `categorizeTool` → `summarizeToolResult`; assert the
   human strings + categories.
2. `NODE_OPTIONS=--max-old-space-size=8192 npm run check` → 0 errors.
3. Adversarial code-review pass on correlation/dedup.
4. Deploy; `/jkai` 200; visual spot-check.

## Decision Log

| Fork | Options | Chosen | Why | Reversible |
|---|---|---|---|---|
| Summary source | (a) deterministic per-tool formatters (b) LLM-generated per call | **(a)** | zero latency/cost, works on reloaded history, no failure surface; a Hermes-supplied `summary` already wins when present, so an LLM layer can be added later without rework | yes |
| Where to unwrap `jkai_extended` | (a) at the bus publish (b) in the UI from args | **(a)** | one place, fixes persisted metadata + any future audit, keeps UI dumb | yes |
| Category colour | (a) monochrome (b) full categorical palette (c) restrained token tints | **(c)** | scannability without a rainbow; identity-stable, tokens only (SR discipline + dataviz rule) | yes |
| Double-render | keep / fix now | **fix now** | two cards per call is the biggest driver of "verbose"; the redesign's one-line-per-action vision needs it | yes |
