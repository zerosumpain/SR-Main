# jkai prompt + toolkit slimming — spec

**Date:** 2026-08-02
**Status:** in progress
**Repos touched:** `~/strange_rambling_svelte/`, `~/.hermes-jkai/`

## Problem

A jkai turn costs a measured **median 35,551 input tokens** (288 billed sessions;
30 most recent median 42,285). The prefill floor for a canvas chat is ~28,100:

| Component | Tokens | Share |
|---|---|---|
| Hermes system prompt (median of 292 sessions) | 5,427 | 19% |
| Skill file injected into the cached system slot | 14,341 canvas / 11,071 general | 51% / 44% |
| jkai MCP manifest (19 tools) | 8,367 | 30% |

The 2026-05-27 prefill-reduction plan cut the manifest from ~28k to ~8.4k via the
`jkai_extended` meta-tool. That win was given back: `jkai-canvas/SKILL.md` grew to
57KB and `jkai-general/SKILL.md` to 44KB, and since Phase 1 both are injected into
the cached system slot on every chat.

### Four structural findings

**1. The skill has become the tool manifest.** Of 1,378 meta-tool calls in
production: 1,185 `invoke`, 119 `list`, 77 `schema`. The model does not discover
tools — it invokes by name from the skill file. So the manifest was not removed, it
was retyped by hand into prose that drifts. Evidence of drift: the canvas skill says
"Tool Inventory (23)" (there are 24); it references `workflow_create` 4× (unregistered);
the model once hallucinated `workflow_inspect_node_type`.

**2. Tool economics override the prompt.** Both the skill and the tool description say
*prefer `workflow_generate`* (grounds in the node registry, plans, critic round,
verifies, self-heals). Production: `workflow_build_from_spec` 26 calls,
`workflow_generate` 3. Cause: `build_from_spec` is on the free essentials list;
`generate` costs a discovery round-trip. The cheap road won.

**3. The recovery strategy is delete-and-retry, not repair.** Session
`20260717_122149_63b6ee0b`: **13 builds, 14 deletes, 11 node lookups, 0 lints, 0
repairs** — the same workflow rebuilt fourteen times. Blocking errors were
`Unknown config key "body"`, `Reference "input.get" not found in upstream schema`,
and `input.output.enroute` — the `.output.` wrapper trap *explicitly documented in
the skill the model was reading*.

The guidance that would have stopped it ("the canvas was still created, repair with
`workflow_update_node`, don't rebuild") **is** in that skill — buried inside a
2,063-character single line containing literal `\n` escapes, uncommitted, which also
clobbered the heading of the section below it.

**4. One red line was still prose, not a machine check.**

The analysis originally listed three unenforced traps. Two of them — the fan-in
collision and the cron timezone — **were fixed upstream in PRs #84/#85/#86 on
2026-08-02, a couple of hours before this work began**; the checkout this analysis
was performed against was four commits stale, so `$lib/workflows/fan-in.ts` and
`$lib/workflows/cron-timezone.ts` were genuinely absent from the files read. Those
findings are withdrawn, and no change here touches either area.

The third stands:

- **Secret in node config** — `SensitiveRefusalError` is wired to the UI's REST
  route. The MCP tools write straight to the database with no scan. The human
  clicking in the browser is protected; the LLM — which pasted a live bank
  `client_secret` on 2026-08-01 — is not. That is backwards, and it is the one
  red line this spec closes.

**5. One tool eats 38% of the manifest.** `presentation_build_from_spec` costs 3,147
tokens; **10,962 of its 12,588 bytes are description prose** (the slide-kind catalogue).
Its actual schema is 1,035 bytes. It is present in every canvas chat and every WhatsApp turn.

## Principle

> A red line that lives in a prompt is a suggestion. A red line that lives in the write
> path is a red line.

Push every constraint down to the lowest layer that can enforce it. The prompt carries
only what no check can decide. Tool *results* are the best just-in-time slot available —
uncached anyway, and read at the exact moment the model is wrong.

## Changes

### A. Red lines become machine checks (repo)

- Reuse `credentialFields` from `$lib/canvas/mutate.server` (already exported, already
  tested) in every MCP node write — `workflow_add_node`, `workflow_update_node`,
  `workflow_build_from_spec` (whole spec, before the canvas row exists) and
  `workflow_generate` (the generated graph, before persistence). A second copy of the
  detector was deliberately not written: these patterns already drift across three files.
- Fan-in detection and cron timezone: **no change** — shipped upstream in #84–#86.

### B. Tool economics match the instructions (repo)

- `mcp/essentials.ts` — promote `workflow_generate` and `workflow_lint`; keep
  `workflow_build_from_spec` but re-describe it as the escape hatch.
- `presentations.ts` — move the slide-kind catalogue out of the tool description into a
  new extended tool + the `jkai-decks` skill; leave a short description.

### C. Errors teach at the point of failure (repo)

- `workflow_build_from_spec` / `workflow_generate` failure envelopes state plainly that
  the canvas exists and must be **repaired with `workflow_update_node`, not deleted**.
- Verifier issues carry a `fix` field with the concrete correction.

### D. Discovery ergonomics (repo)

- `workflow_list_node_types` gains a `query`/`category` filter (currently dumps all 88
  types at 5,120 tokens per call, no arguments).
- `workflow_describe_node` accepts an array of types — a 6-node build becomes 2 calls
  instead of 7.

### E. Skills shrink to judgement only (Hermes)

- Repair the corrupted line and the clobbered heading; remove the 4 dead
  `workflow_create` references.
- Delete every pitfall that is now a linter rule or a tool-description line.
- Fix stale `USER.md` (tells the engine to deploy via `scripts/deploy.sh` — forbidden)
  and `.hermes.md` (lists decommissioned `zai`/`anthropic` providers).
- Commit the 6 drifted skills.

## Forecast vs actual

| Change | Forecast | Actual |
|---|---|---|
| Deck catalogue out of the tool description | −2,447 | **−2,366** |
| Trim `workflow_build_from_spec` prose | −328 | **+90** (grew — it now steers to `workflow_generate`) |
| Promote `workflow_generate` | +416 | **+416** |
| Promote `workflow_lint` | +163 | **+163** |
| `jkai-canvas` skill | −9,341 | **−5,905** (57,363 → 33,744 B) |
| `jkai-general` skill | −4,071 | **−2,034** (44,282 → 36,144 B) |
| **Net** | −15,608 | **−9,636** |

Canvas floor 28,135 → **~20,400 (−27%)**; forecast said 16,600 (−41%).
General floor 24,865 → **~21,000 (−15%)**; forecast said 18,600 (−25%).
`list_node_types` 5,120 → ~700 per filtered call (−86%), as forecast.

**Why the skills under-delivered against forecast.** The forecast assumed most of
each file was mechanical lore convertible to linter rules. About 60% was. The
remainder — the design-first operating procedure, scope discipline, the domain
routing table in `jkai-general`, the worked examples — is behavioural instruction
with no machine equivalent, and cutting it would trade prefill tokens for
regressions that are expensive to detect. Stopped at the point where further cuts
would have been guesses about what the model does not need.

## Verification

- `npm run check` + `npm run gate` green.
- Unit tests for the fan-in detector, the write guard, the cron timezone default, and
  the filtered node listing.
- Re-fetch `tools/list` from the live MCP endpoint and diff manifest bytes against the
  33,471-byte baseline.
- Re-measure skill bytes against 57,363 / 44,282.
- Deploy via CI, then confirm on production.

## Decision Log

| Fork | Options | Chosen | Why | Reversible |
|---|---|---|---|---|
| Remove `presentation_build_from_spec` from essentials vs shrink it | (a) demote to extended (b) shrink description | **(b)** | Demoting risks the deck build UX the essentials comment documents; shrinking gets ~78% of the saving with no behaviour change | Yes — one-line list edit |
| Keep `workflow_build_from_spec` essential | (a) demote (b) keep, re-describe | **(b)** | It is the general-hub new-canvas path; demoting would trade one thrash class for another | Yes |
| Sensitive scan on MCP writes: refuse vs warn | (a) refuse (b) warn | **(a)** | Matches the REST route's existing behaviour; a warning is what we already have and it did not prevent 2026-08-01 | Yes |
| Duplicated fan-in + cron work found mid-build | (a) keep mine (b) drop mine for upstream | **(b)** | PRs #84–#86 already shipped both, with tests, and are deployed. Two implementations of one rule is the drift this spec exists to remove | n/a — mine was never committed |
