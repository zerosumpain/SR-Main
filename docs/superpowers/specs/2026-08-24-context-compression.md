# Stage 4 — context compression, and recall across conversations

**Status:** shipped · **Date:** 2026-08-24 · Hermes exit plan, S4

## Problem

The plan called this "context compression, because long conversations will hit
the context ceiling". Reading the code, it is worse and simpler than that: the
in-process lane did `conversationHistory.slice(-MAX_HISTORY)` with
MAX_HISTORY = 30. Message 31 back simply vanished, with nothing in the prompt
saying so. Not a ceiling — silent amnesia, which is how a long thread comes to
contradict what it agreed to an hour earlier.

## What was already there

Most of the "memory" half did not need building. `memory-review.ts` already
extracts durable facts from idle conversations into `jkai_memories`, and
`memorySection` already injects them into every system prompt — automatic, which
Hermes' manual `memory` verb is not. What was missing was interrogating it on
demand, and searching what was actually SAID rather than what was remembered.

## Design

`$lib/workflows/chat/compress.ts`:

- Recent 30 turns stay verbatim; everything older becomes prose.
- **Incremental.** The record stores `coversUpTo`, so each turn folds in only what
  newly fell out of the window. Without that, every turn on a long thread
  re-summarises the whole thing — an LLM call per turn, for ever.
- Cached in the datastore (`chat-compression`), keyed by conversation, following
  the `briefing/feedback.ts` pattern. No migration.
- **Honest on failure**: keep MORE raw messages than before (2×), and say plainly
  that earlier context is missing.

`site-tools/tools/recall.ts`: `session_search`, `memory_search`, `memory_remember`.

## Decision Log

| # | Decision | Options | Chosen | Why | Reversible |
|---|---|---|---|---|---|
| 1 | Overflow handling | drop (today) / summarise / raise MAX_HISTORY | **Summarise** | Raising the cap defers the problem and costs context every turn. Dropping is the bug. | Yes |
| 2 | Re-summarise or fold | whole history each turn / incremental | **Incremental** | Whole-history is an LLM call per turn on exactly the threads that are already long. | Yes |
| 3 | Cache location | new column / orchestrator_chats.metadata / datastore | **Datastore** | No migration, TTL available, and a summary is derived data rather than a message. A metadata stamp on a real message would surface in the UI. | Yes |
| 4 | No conversation id (canvas chat) | summarise anyway / truncate + flag | **Truncate + flag** | Nothing to cache against, so summarising would re-bill every turn and discard the result. Flagged so the model knows context is missing. | Yes |
| 5 | Summary model | pin a cheap one / site default | **Site default** (`resolveDefaultModel`) | Matches `memory-review.ts`, the closest precedent. Pin later if the cost shows up in the ledger. | Yes, one line |
| 6 | Failure fallback | drop as before / keep more | **Keep 2× and say so** | The fallback for fixing silent truncation must not be silent truncation. | Yes |
| 7 | `memory` verb | port Hermes' / use what exists | **Use what exists** | `jkai_memories` + automatic extraction already beats it; only the read/write verbs were missing. | Yes |

## Verification

- 12 compression tests: the fold (previous digest carried in, already-covered
  messages not resent), cache reuse without an LLM call, persistence of
  `coversUpTo`, and every degradation path.
- `gate:check` 0 errors · `gate:test` 615 files / 7198 tests / 0 failures.
