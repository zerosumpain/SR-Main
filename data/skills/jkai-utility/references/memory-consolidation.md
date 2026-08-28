# Memory Consolidation — two stores, and how to prune

When John asks to "review the toolchain" or "consolidate memory", or when the
always-injected memory block is near its char cap, run this. It frees headroom
so new durable facts can be saved without evicting old ones.

## The two stores (do not confuse them)

1. **Always-injected Hermes memory block** — the compact notes injected into
   every turn (shown in the system prompt as `MEMORY (your personal notes)` with
   a char budget, e.g. `99% — 2,188/2,200 chars`). Managed via the `memory`
   tool (`action: add|replace|remove`, `target: "memory"`). This is the one that
   matters for the cap — it's paid on every single turn.

2. **Site knowledge store** — the `jkai_memories` table, searched via
   `recall_memories` / `forget_memory` (MCP). This is the long-tail store of
   facts about John and the platform. It has no hard char cap but accumulates
   stale entries. `recall_memories()` with no args returns everything (paginated).

**Key insight:** platform how-tos and tool guidance belong in SKILLS (loaded on
demand), NOT in the always-injected memory block (paid every turn). The memory
block should hold only compact, high-value facts that must be present without a
skill load.

## The consolidation workflow

1. **`recall_memories()`** (no args) to dump the site store; read the system
   prompt's `MEMORY` block for the always-injected set. Get IDs for everything
   you may prune.
2. **Move platform how-tos into skills first.** For each fact that is really
   "how to do X on this platform" (publish_page, register_chat_build,
   TrueLayer creds, workflow merge behaviour), check whether a skill already
   covers it. If yes → delete the memory entry. If no → patch the governing
   skill (or its `references/`) with the fact, THEN delete the memory entry.
3. **Prune stale / wrong / re-derivable entries from the site store** via
   `forget_memory(id)`:
   - **Wrong / contradicts current docs** — highest priority. E.g. an entry
     claiming "assistant can't edit workflows from general chat" when
     `workflow_amend` exists; a cron-script entry for scripts the reference
     marks as retired; a hand-rsync deploy note that caused the 33h outage.
   - **Stale snapshots** — OpenRouter balance, workflow node/edge counts, "last
     ran on X", "not yet built". These are re-derivable from live tools
     (`workflow_inspect`, `api_integration_call`) and go stale fast.
   - **Duplicates of the user profile** — e.g. "prefers terse bullets" already
     in the profile block.
4. **Consolidate the always-injected block** with `memory` tool:
   - `replace` stale entries with corrected facts (e.g. the MCP-bridge note:
     "MCP tools hit PRODUCTION since 2026-08-03 (MCP_UPSTREAM=…)").
   - `remove` entries that now live in skills.
   - Keep only compact, must-always-know facts.
5. **Verify** — re-run `recall_memories()` and re-read the memory block. Confirm
   the char % dropped (e.g. 99% → 36%) and that no personal facts were lost.

## What to keep vs prune

| Keep in memory | Prune / move to skill |
|---|---|
| Personal facts (kids' ages, asthma, HA device inventory, bike prefs, pizza dough) | Platform how-tos (publish_page, register_chat_build, TrueLayer creds) |
| Compact must-always-know platform facts (MCP→production) | Stale snapshots (balances, node counts, "last ran") |
| Open investigation notes (unresolved workflow bugs) | Duplicates of user profile |
| | Wrong/contradictory entries (highest priority) |

## Example outcome

A 2026-08-07 pass took the always-injected block from 99% (2,185/2,200) to 36%
(800/2,200) and removed ~22 stale/wrong entries from the site store, while
patching `jkai-platform-internals` (workflow merge-behaviour pitfall) and
`jkai-general/references/natwest-open-banking.md` (TrueLayer settlement lag) with
the displaced facts. No personal facts were lost.
