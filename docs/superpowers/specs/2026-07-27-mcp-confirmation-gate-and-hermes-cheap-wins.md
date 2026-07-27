# MCP confirmation gate + Hermes cheap wins

Date: 2026-07-27
Status: in progress
Driver: Hermes integration review (2026-07-27). Items 1 and 2 of the recommendation.

## Problem

**1. The destructive-action confirmation gate does not run in production.**
`src/lib/workflows/chat/confirmation-gate.ts` exports `requireConfirmation`, but its only
non-test caller is `src/lib/workflows/chat/general-chat.ts:346` — the engine that
`JKAI_HERMES_CANVAS_CHAT=1` bypasses. The live path is
`src/lib/mcp/jsonrpc.ts` `tools/call` → `executeTool`, and that file contains **zero**
references to `destructive` or `confirm`. `src/lib/mcp/server.ts:22-28` states the design
intent outright: the `destructiveHint` annotation is surfaced "so the Hermes agent can
require user confirmation".

So the only thing between an LLM and `node_builder_commit_and_deploy` — whose own gate
copy reads *"Commit to origin/master and DEPLOY TO PRODUCTION? This ships live."* — is
Hermes' own behaviour, detected site-side by a hardcoded emoji string match at
`src/lib/jkai/slash-commands.ts:33`. Same exposure for `publish_page`, `gmail_send`,
`gmail_reply`, `whatsapp_send`, `datastore_delete`, `workflow_delete`,
`workflow_clear_data_store`, `build_delete`, `build_control`, `scraper_script_delete`,
`scraper_script_save`.

**2. Five Hermes capabilities are installed, configured and unused**, each closing a
known failure class rather than adding surface.

## Constraint that shapes the design of (1)

`tools/call` is a **synchronous HTTP request** from Hermes, so blocking it on a human has
a hard ceiling. Measured:

| Hop | Timeout |
|---|---|
| Hermes `mcp_servers.jkai.timeout` (config.yaml) | 900s |
| Hermes httpx read timeout (`tools/mcp_tool.py:1511,1556`, hardcoded) | **300s** |
| `scripts/mcp-gateway.mjs` per-attempt (`MCP_GATEWAY_CALL_TIMEOUT_MS`) | 900s |

The binding constraint is the hardcoded **300s httpx read timeout**. A gate that waits
longer than that strands the turn rather than protecting it.

## Design

### Item 1 — gate destructive tools at the MCP dispatcher

Seam: `src/lib/mcp/jsonrpc.ts` `tools/call`, after `resolveDisplayTool` (so the check sees
the *real* tool, not the `jkai_extended` meta-dispatcher) and before execution.

The MCP layer has no `jobId` — it only knows `busKey` (`workflow_id` arg, or
`_meta.chat_id`). The chat route knows `busKey → jobId`. That is exactly the seam
`tool-step-bus.ts` already bridges, keyed identically, so the confirmer registry goes
**there** rather than in a new module:

- `registerToolConfirmer(busKey, fn)` / returns an unregister closure — mirrors
  `subscribeToolSteps`.
- `requestToolConfirmation(busKey, req)` — resolves via the registered confirmer.

The chat route registers its confirmer next to the existing `subscribeToolSteps` call and
delegates to `requireConfirmation(jobId, …)`, reusing the existing `confirm` JobEvent,
`ConfirmBanner.svelte` and `confirm_ack` waiter untouched.

Timeout: **240s**, then **deny** — inside the 300s httpx ceiling with margin, and
fail-closed. Denial returns a normal tool result (not a JSON-RPC error) so the agent reads
it as "the user declined" and can respond, rather than treating it as a transport fault.

Unattended calls (no confirmer registered — Hermes cron/WhatsApp sessions, Claude Code as
an MCP client) are governed by `MCP_CONFIRM_UNATTENDED`, default `deny`.

Not in scope: `executeTool` callers that never pass through MCP (heartbeat, briefing,
scheduled, routing, selfimprove, workflow nodes). Gating those would break headless runs
that legitimately mutate. The MCP dispatcher is the agent-driven surface and the correct
narrow seam.

### Item 2 — cheap wins

| # | Change | Shape |
|---|---|---|
| 2a | `clarify` gateway → `ClarifyCard` | `adapter.py` `send_clarify` + `sse-adapter.ts` `case 'clarify'`; the `clarify` JobEvent, `ClarifyCard.svelte` and `clarify_ack` waiter all already exist |
| 2b | `checkpoints.enabled: true` | one line in `~/.hermes-jkai/config.yaml` + restart |
| 2c | Local faster-whisper STT | new `extract/stt-local.ts`; `audio.ts` tries local, falls back to today's OpenRouter path. `video.ts` funnels through `audio.ts`, so covered |
| 2d | Edge-TTS fallback | `media-generate-audio-tts.ts`: ElevenLabs stays primary, edge-tts replaces the hard failure when the key is absent |
| 2e | Key-free search skills | sync `optional-skills/research/{duckduckgo-search,searxng-search}`, install `ddgs`, reference from `jkai-general` |

Verified installed in the Hermes venv: `faster_whisper 1.2.1`, `edge_tts 7.2.7`.
**Not** installed: `piper` (dropped from scope — edge-tts alone covers the free path),
`ddgs` (installing).

## Verification commands (named before writing code)

| Item | Proof |
|---|---|
| 1 | `npx vitest run src/lib/mcp/` green, incl. new gate tests; then live `curl` of `/api/mcp/local` calling `workflow_delete` with a bearer and no confirmer → denial payload, workflow still present |
| 2a | Live `/jkai` turn that triggers clarify → `ClarifyCard` renders, answer resolves the turn |
| 2b | `grep -A1 '^checkpoints:' ~/.hermes-jkai/config.yaml` shows `enabled: true`; `hermes checkpoints list` runs |
| 2c | Node harness calling `extractAudio` on a generated wav → non-empty text, log shows the local path |
| 2d | `handleGenerateAudioTts` with no ElevenLabs key → `success: true` + playable mp3 attachment |
| 2e | `ddgs text -q "test" -m 3` returns results; skill dirs present under `~/.hermes-jkai/skills/research/` |

Full gate: `npm run gate` (never with `.env` sourced — see `reference_svelte_dev_env`).

## Decision Log

| # | Decision | Options considered | Chosen | Why | Reversibility |
|---|---|---|---|---|---|
| D1 | Where to gate | (a) `executeTool` in the registry — catches everything; (b) MCP dispatcher only; (c) each destructive handler | **(b)** | (a) breaks headless callers (heartbeat/briefing/scheduled/selfimprove/workflow nodes) that legitimately mutate without a human; (c) is 12 edits and drifts. (b) is the agent-driven surface and one seam | High — one call site |
| D2 | Gate timeout | (a) unbounded like `requireConfirmation`; (b) 240s then deny; (c) 240s then allow | **(b)** | 300s httpx read timeout is the real ceiling; unbounded strands the turn. Fail-closed is the point of the change | High — one constant |
| D3 | Unattended MCP calls | (a) allow (today's behaviour); (b) deny; (c) env-switch, deny default | **(c)** | Fail-closed by default without permanently breaking Hermes cron/WhatsApp; `MCP_CONFIRM_UNATTENDED=allow` is the escape hatch | High — env var |
| D4 | Denial transport | (a) JSON-RPC error `-32603`; (b) normal tool result text | **(b)** | An error reads as a transport fault and invites a retry loop; a result reads as "user declined" and the agent responds to the human | High |
| D5 | Confirmer registry home | (a) new module; (b) extend `tool-step-bus.ts`; (c) `job-store.ts` | **(b)** | Same `busKey`, same lifecycle, same registration site in the chat route. (a) invents a parallel pattern; (c) drags job-store into the MCP layer | High |
| D6 | Local STT interpreter | (a) hard-code the Hermes venv; (b) `LOCAL_STT_PYTHON` env, default Hermes venv; (c) install a dedicated venv | **(b)** | `faster_whisper` only exists in the Hermes venv today, but the review's direction is *less* Hermes coupling — an env var means a later move is config, not code | High |
| D7 | STT failure behaviour | (a) local-only; (b) local, fall back to OpenRouter | **(b)** | Local isn't installed on the VPS; strictly-better-than-today matters more than purity | High |
| D8 | TTS ordering | (a) edge-tts primary (free-tier preference); (b) ElevenLabs primary, edge-tts fallback | **(b)** | Non-regressive: today's output quality is unchanged and the *hard failure* path becomes free audio. `feedback_prefer_free_tier_services` is about avoiding standing charges, not degrading a working feature | High — swap order |
| D9 | Piper | (a) install; (b) drop | **(b)** | Not installed; edge-tts already covers the zero-key path. Avoids a 2nd model download for no added capability | High |
| D10 | `ddgs` install | (a) skip 2e as paper-only; (b) `pip install ddgs` into the Hermes venv | **(b)** | A synced skill whose CLI is missing fails at call time — worse than not shipping it. Free package, no standing cost | High — uninstall |

## Descoped

- Piper TTS (D9).
- Gating non-MCP `executeTool` callers (D1) — noted as a residual gap: a workflow node or
  scheduled run can still invoke a destructive tool unattended, by design.
- Migrating the historical 3,977 tool calls out of Hermes' `state.db`.
