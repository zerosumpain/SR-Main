# jkai first-message efficiency — spec & plan (2026-08-20)

Approved by John 2026-08-20 ("i love all those ideas"). Planned on Fable, implemented by Opus agents.

## Problem (measured baseline, 2026-08-20)

- Median time to first visible **text** on a first message: **30.3s** (last 30 multi-turn jkai sessions, Hermes state.db). Median 3.5 tool round-trips before any text.
- First assistant emission is a tool call in 18/25 recent chats — almost always `skill_view`, mandated by `## Skills (mandatory)` in the Hermes base prompt.
- Every first message runs a **silent `/model` turn awaited up to 15s** client-side before the real message is POSTed (`ChatArea.svelte:2043–2085`), plus a possible second re-pin in the server pump (`PIN_WAIT_MS = 12s`).
- First API call ships ~23.5k input tokens with **zero cache reads** (73KB system prompt; 60% is the 43KB `jkai-general` SKILL.md injected wholesale). First turns cost ~10× follow-ups.
- The UI renders **nothing** for the first ~5s minimum (first heartbeat at 5s; typing dots removed 2026-05-28; during the silent turn no job exists).
- Tool presentation: streaming view renders one `step-card` per call, no grouping. Settled view already groups the whole turn (`details.tool-activity`).

Site request path is ~90ms — do not optimise round-trip plumbing for speed; remove round-trips that shouldn't exist.

## Workstreams

### WS1 — Move the model pin out of the first-send path (Agent A, svelte repo)

**Current:** `send()` → `applyRouting` (await, HTTP) → `ensureHermesModel` (await, full silent `/model` turn, ≤15s) → real POST. No first-message path avoids the silent turn.

**Target:**
- Fire `tellHermesModel` **fire-and-forget** at the point the conversation id is first known (new-chat creation / conversation open), recording `hermesModelAssertedFor`. Do NOT await it at send time.
- In `send()`, drop the awaited silent turn entirely. Keep `applyRouting` (69ms, cheap) but if routing switches the model, issue the `/model` push fire-and-forget too — correctness comes from ordering: silent turns and the user turn go through the same job store, which queues per conversation (`whenJobSettles`), so the pin lands before the user turn is delivered.
- Keep the server pump's `ensureModelPinned` (`+server.ts:816`) exactly as the backstop. Do not remove `PIN_WAIT_MS`.
- Void the `recordRoutingDecision` DB write inside `/api/jkai/routing/resolve` (best-effort already; stop awaiting it).
- Respect the 2026-08-09 wrong-model incident (comment at `ChatArea.svelte:2066–2076`): the guarantee MOVES, it doesn't disappear. Verification below must prove the pin still lands.

**Explicitly out of scope:** provider cache pre-warm at conversation-open. First check (read-only, state.db) whether the `/model` slash turn even triggers an LLM call — if it doesn't (likely; it's a runtime command), pre-warming needs a real mini-turn and is a separate costed experiment. Record the finding in the PR description; do not build it.

**Files:** `src/lib/components/jkai/ChatArea.svelte` (send/applyRouting/ensureHermesModel/tellHermesModel), `src/lib/routing/events.ts` (`recordRoutingDecision` call site), possibly `src/routes/api/jkai/routing/resolve/+server.ts`.

**Verify:** (1) After the change, submit→POST gap for a first message < 200ms (instrument via the existing TTFT probe pattern — POST + SSE with timestamps). (2) Fresh conversation → send first message → `sqlite3 ~/.hermes-jkai/state.db "SELECT model FROM sessions ORDER BY started_at DESC LIMIT 1"` equals the routed model. (3) No 409/queue drops: send two rapid first messages in a new chat and confirm both answered (hermes queue-mode drop history — see memory `reference_hermes_queue_mode_drops_messages`).

### WS2 — Direct-answer lane + current date in prompt (Agent B, hermes-agent repo, `jkai-local-patches` branch)

- In `~/hermes-agent/agent/prompt_builder.py`, soften `## Skills (mandatory)`: keep the MUST for tasks that *act* (build, edit, schedule, send, look up live data), add an explicit lane: conversational messages, quick factual questions answerable from the prompt/memory, and follow-up clarifications are answered **directly, no skill load**. Keep "err on the side of loading" only for action tasks.
- Inject current date/time into the system prompt (check first whether prompt_builder/config already supports a datetime block — enable it if so, add a small one if not), then delete the "Current time, date, timezone → use terminal" line from `<mandatory_tool_use>`.
- Do NOT touch `agent.tool_use_enforcement` (builds rely on it).
- These files are shared by all Hermes platforms — keep edits minimal and wording-level; no structural rewrites.
- Deploy: editable venv install — edit checkout + `systemctl --user restart jkai-hermes` (it is a **user** unit). Commit on `jkai-local-patches`, push to the **backup** remote (zerosumpain/hermes-agent), never `origin`.

**Verify:** send 3 test first-messages through a fresh chat ("thanks, looks good", "what day is it today?", "what's the capital of France?") and confirm via state.db that the first assistant emission is text with zero tool calls. Then one action message ("check my calendar for tomorrow") and confirm it still loads the right skill.

### WS3 — Acknowledge-first (split)

**3a (Agent A, svelte):** instant client-side status. At `send()`, before any network work, give the progress bubble a synthetic phase so `heartbeatLine` renders immediately (reuse the existing heartbeat/phase mechanism — `phaseHumanLabel`, `heartbeatLine` snippet at `ChatArea.svelte:2477–2503` — do not reinvent a spinner). Copy: plain words, e.g. "received — working…", replaced by the first real server heartbeat/frames. Server heartbeat cadence stays 5s.

**3b (Agent B, `~/.hermes-jkai/skills/jkai-general/SKILL.md`):** add a rule near the top behavioural section: when the first action of a turn will be a tool call, first stream ONE short plain sentence saying what you're about to do ("Checking your calendar."), then proceed. One sentence, no bullet lists, no restating the question. Scoped to the jkai channel prompt, NOT prompt_builder (keeps it out of other Hermes platforms).

**Verify:** 3a — screenshot/DOM check on a first message shows the status line within 100ms of submit. 3b — state.db: on a fresh action-message turn, the first assistant row has non-empty text content before/with the first `tool_calls` row.

### WS4 — Streaming collapsed "toolchain" bar (Agent A, svelte)

- In the streaming branch of `ChatArea.svelte` (`step-cards` region ~:2606–2768): collapse the in-flight tool steps into **one bar** labelled `toolchain`, collapsed by default: status glyph + `toolchain` + live step count + the *current* step's category chip and running summary inline (WorkerTray's collapsed-shell pattern: `wt-latest` line, live count). Expanding shows the existing `step-cards` list unchanged.
- Reuse, don't reinvent: consecutive-run collapse helper shape from `DelegateChildren.svelte:11–24` (`runs()`), category chips from `src/lib/workflows/chat/tool-summary.ts`. If the runs() helper is extracted for reuse, it moves to `tool-summary.ts` (single source of truth for tool presentation).
- Keep: the slow-step Cancel affordance (`TOOL_STEP_SLOW_MS`) must remain reachable — surface it on the bar when the current step crosses the threshold, not only inside the expanded list. `status_update` prose stays inline (not swallowed by the bar). Settled view (`details.tool-activity`) unchanged. `toolCallId` correlation logic unchanged.
- Design: `sr-design` skill + existing chip styles; 12px type floor; no new fonts/colors.

**Verify:** `npm run check` clean; existing vitest suites for tool-summary/jsonrpc/sse-adapter pass; headless screenshot of a streaming multi-tool turn (local-qa skill) showing one bar while running and the expanded list on click. Eyeball every screenshot for personal data before sharing.

### WS5 — Promote hot first-turn tools (Agent A svelte half, Agent B hermes half)

- **Measure first** (read-only): from state.db, extract the actual `jkai_extended` sub-tool names invoked on FIRST turns (the `name` inside `{operation:'invoke'}` args), top 5 by thread count.
- **Svelte half (A):** promote the top 3–5 (likely calendar/memory/knowledge family) to top-level essential MCP tools alongside `workflow_generate`/`workflow_lint` (find the `ESSENTIAL_TOOL_NAMES` / essentials mechanism in `src/lib/mcp/`). Budget: ≤ ~1.5k tokens of added schema — trim descriptions to fit; run `~/.hermes-jkai/scripts/sync-tool-inventory.py` after (`--check` must pass).
- **Hermes half (B):** leave the Tool Search bridge ON (`tools.tool_search: auto`) — inlining all 21 schemas would re-add ~8.4k tokens/turn. The essentials promotion is the fix.
- **Rollout trap:** the MCP manifest is **frozen at connect** and served by the homeserv svelte service — the manifest changes take effect only after (1) the homeserv service is rebuilt/restarted (respect the build-clobber trap: `build/` is the always-on service dir) and (2) Hermes is restarted to reconnect. Sequence this in Phase 2, not mid-implementation.

**Verify:** `sync-tool-inventory.py --check` exits 0; after Phase 2 restarts, POST `tools/list` to the MCP endpoint shows the promoted tools; a fresh "what's on my calendar" first message reaches the domain tool with fewer discovery hops (compare tool round-trips in state.db before/after).

### WS6 — Slim jkai-general SKILL.md (Agent B, `~/.hermes-jkai` repo)

- Precedent: `docs/superpowers/specs/2026-08-02-jkai-prompt-toolkit-slimming.md` (same operation, same file).
- Move the inline CSS design-system block (~L314–343) and the worked workflow JSON example (~L427–473) into `references/` files loaded on demand; leave one-line pointers. Target 43.2KB → ≤30KB. Cut nothing behavioural.
- Keep the direct-reply list and extend per WS3b. Skill index description stays ≤60 chars.
- Commit every tweak in the `~/.hermes-jkai` repo. Hermes restart required after any SKILL.md edit.

**Verify:** `wc -c ~/.hermes-jkai/skills/jkai-general/SKILL.md` ≤ 30,000; after restart, a fresh chat's logged `channel_prompt` size shrinks accordingly (gateway.log line "cached skill 'jkai-general' … chars"); an action message still follows moved-reference behaviour (spot-check one: reference loads on demand).

## Agent split & sequencing

- **Agent A (Opus)** — everything in `~/strange_rambling_svelte`: WS1, WS3a, WS4, WS5-svelte. One branch off master: `jkai-first-message-efficiency`. Invoke `local-qa`, `sr-design`, `svelte5-pitfalls` skills. Do not deploy; stop after gates pass + commit + push + PR.
- **Agent B (Opus)** — everything Hermes-side: WS2, WS3b, WS6, WS5-hermes. Repos: `~/.hermes-jkai` (commit every tweak) and `~/hermes-agent` (`jkai-local-patches`, push to backup remote). May restart `jkai-hermes` (user unit) to test its own prompt changes — that affects prod chat briefly; acceptable, changes are prompt-level and reversible by git revert + restart.
- A and B run in parallel — disjoint repos. Both may READ `~/.hermes-jkai/state.db`.

**Phase 2 (conductor, after both agents finish):** review diffs → merge PR → CI deploys VPS → rebuild/restart homeserv svelte service (build-clobber trap) → restart Hermes (reconnect = new manifest; SvelteKit before Hermes, per turn-desync memory) → live verification.

## Live verification (definition of done)

1. Fresh chat on strangeramblings.com/jkai: status line visible immediately on submit; first text within ~5s on a conversational message (no tool call); action message shows the ack sentence then the collapsed toolchain bar.
2. TTFT probe before/after numbers in the PR: submit→POST < 200ms; median first-text on 5 test messages vs the 30s baseline.
3. state.db: pinned model correct on 3 fresh chats; first-turn text-first rate re-measured on the next ~20 organic chats (follow-up check, not a gate).
4. Cost spot-check: `metadata->'usage'` on a first turn after WS6 shows reduced input tokens (~3k+ lower from the skill cut).

## Decision Log (Phase 2, 2026-08-20)

- **Inline review instead of the multi-agent pass** — the /code-review fan-out hit the session usage limit mid-scan. Options: wait ~3h for the reset, or review the true diff (5 files, 414 insertions) inline. Chose inline under the standing "keep going": gates were already green and the change had been live-tested; verified the two review-critical facts by hand (`untrack` imported; a new chat tab has a conversation id at open, so the open-time pin effect fires). Reversible — the ultra review can still be run on the merged commit later.
- **Reused Agent A's worktree build for the homeserv service** instead of rebuilding: worktree was clean at the branch tip, whose content equals the squash commit. Saved ~10 min and dodged the sandbox/OOM build traps. Old `build/` kept as `build.bak-20260820-pre-firstmsg`.
- **Hermes restart deliberately sequenced after the VPS deploy** — the gateway's manifest upstream is production, so restarting earlier would have re-frozen the old 21-tool manifest.
- **Timezone set to Europe/London** (John's direct order) — cron store confirmed empty first, so nothing shifted.
- **Committed only the sync-script's own file** in `~/.hermes-jkai` — the working tree carried unrelated pre-existing edits; they are not this programme's to ship.
- **Action-turn tail sprawl left alone** — the probe's HA turn took 54s hunting entity names via `jkai_extended` with malformed-arg retries after a fast, correct start. Pre-existing Codex-bridge behavior, out of scope; noted for a follow-up.

## Phase 2 verification results (all live)

- PR #381 merged as `debb095c`; CI green; VPS `.deploy-sha` = `debb095c` (via github-actions).
- Homeserv service healthy on the new build (NRestarts 0, HTTP 200); local + gateway `tools/list` both show 26 tools including all five promotions.
- Tool inventory regenerated; `--check` clean; committed (`989ba80`).
- Live probes through the production inbound path: "morning" → text-only reply, 0 tools, ~4s. "is the office light on?" → first emission "Checking the office light." + a DIRECT `ha_query_state` call (no discovery hop, no skill_view), correct answer.
- Hermes-side (Agent B, earlier same day): conversational first messages text-first at 3.2–9s; channel prompt 43,633 → 31,114 chars; date line live (model derived "tomorrow" without a clock tool).

## Risks

- Wrong-model regression (2026-08-09 incident) — mitigated by job-store ordering + server backstop + explicit state.db verification.
- Two rapid messages in a new chat racing the fire-and-forget pin — hermes queue mode has dropped messages before; test explicitly (WS1 verify #3).
- Prompt softening (WS2) under-triggering skills — verify with an action message; wording keeps MUST for action tasks.
- Manifest bloat from WS5 — capped at ~1.5k tokens, descriptions trimmed.
- Hermes restarts briefly interrupt prod chat — restart windows are seconds; do them back-to-back in Phase 2.
