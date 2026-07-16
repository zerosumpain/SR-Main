# Workflow Engine Rethink — spec (2026-07-16)

**Brief (John):** the canvas workflow engine's building blocks restrict the planning model from
building robust real-world workflows — the generated "news pipeline → WhatsApp" re-sends the same
story every run because nothing remembers what was sent. Rethink the engine so solutions are
tailored and useful in the real world; keep the canvas viewable/configurable by a user but a
different experience is acceptable. Unify the two canvas experiences (research desk + workflow
canvas). Exploit more site capabilities (/decks, /projects, /drive, RAG, research) from workflows.
Rank features /100 (usefulness, efficiency, effectiveness); implement everything scoring > 30.
Fully autonomous; plan in Fable 5, implement via Opus workflow agents.

## Root causes (evidence)

Forensics on the live pipeline (`canvas:generated-workflow`, id `dde79bdf-…`, 101 runs, cron
`0 7 * * *`) confirmed the failure and where it comes from:

1. **The generator actively suppresses memory.** The workflow's *description* promises results are
   "recorded for deduplication", but the executing DAG is a flat
   `trigger → tavily-search → llm-call → whatsapp` with no memory nodes. The generation prompt
   demands a "Minimum viable graph" and instructs the model to drop data-stores
   (`orchestrator/prompts.ts:104`); the critic's PRIMARY dimension lists "redundant data-stores" as
   bloat to remove (`prompts.ts:128`). Planner and critic form a double-bind around exactly the
   node that fixes the bug. Dedup exemplars exist but are keyword-gated on "new/already seen"
   (`orchestrator/patterns.ts`), which "build a news pipeline" never triggers.
2. **The primitives are too weak even when reached for.** No filter/dedupe node exists anywhere.
   `data-store` is get/set only (no atomic append/set-membership; `nodes/data-store.ts`), its GET
   drops upstream passthrough, and correct dedup today requires a 4-node racy dance
   (parallel-branch → merge → hand-written transform JS → set) the generator essentially never
   constructs. `loop` is map-only (no per-item side-effect fan-out; `loop.def.ts`).
3. **Templates fail silently.** Only `{{input.*}}` resolves (`nodes/template.ts:8`); the live
   pipeline's `{{today}}` never substitutes, so the LLM hallucinates dates ("22 May 2024" on a
   2026-07 run) and runs stay green. `data-store.def.ts`'s own llmExample teaches
   `{{trigger.output.accountId}}` — syntax the engine cannot resolve.
4. **Verification can't see the failure class.** `verify_workflow` is a single dry-run; "re-sends
   across runs" is a run-N vs run-N−1 property. The eval harness's Case 1 is exactly this shape
   (morning headlines digest) and asserts no dedup — the broken workflow scores PASS.
5. **Tool-only capabilities are invisible to workflows.** ~124 site tools across 22 toolsets exist
   behind a uniform `handler(args, ctx) → {success,data,error}` contract with a declarative
   `destructive` flag, but zero workflow nodes reach them: decks, publish-page, RAG `file_search`,
   `research_search`, media generation, personal memory, site-signals are chat-only. The `jkai`
   node is broken (calls renamed tools). The generator grounds only on the node registry, so
   tool-only capability can never appear in a generated workflow.
6. **Two canvases, one copied implementation.** ResearchDesk re-implements pan/zoom, minimap,
   orthPath, screenToWorld, drag near-verbatim from the workflow canvas (drifted copies);
   NodePalette/adapter/InspectorBody are already shared, and a readonly desk already embeds inside
   a workflow node (`ResearchResultNode.svelte`) — proof the seam works.

## Feature candidates — scored /100

Score = mean(Usefulness, Efficiency (value ÷ cost), Effectiveness (will it actually work
robustly)). **Gate: score > 30 ⇒ implement**, except where a documented standing order applies
(see Decision Log). Milestone column maps to the plan.

| # | Feature | U | E | F | Score | Verdict | MS |
|---|---------|---|---|---|-------|---------|----|
| B1 | Generator prompt rebalance: carve memory/dedup out of the minimalism test; hard rule "recurring send workflows MUST remember what was sent" | 95 | 98 | 85 | **93** | build | M2 |
| A1 | `dedupe` node: filter list against persistent seen-set by id-expression, atomic record, passthrough output | 95 | 90 | 92 | **92** | build | M1 |
| B2 | Critic retune: stop naming data-stores bloat; add MISSING-severity "recurring send without dedup memory" check | 90 | 95 | 85 | **90** | build | M2 |
| A4 | Loud template failures: runtime warning event on unknown `{{var}}` + author-time verify rule; `{{today}}`/`{{now}}` builtins | 85 | 95 | 85 | **88** | build | M1 |
| A2 | `data-store` v2: atomic `append`/`add_to_set`/`has`/`increment`/`delete`, `get` with default + passthrough merge; fix invalid llmExample | 85 | 90 | 85 | **87** | build | M1 |
| C1 | Generic `site-tool` node: invoke any registered non-destructive site tool (toolset-grouped picker, templated JSON args, `{success,data,error}` unwrap, destructive⇒refuse unless wired through approval node; dryRun-aware) | 90 | 85 | 85 | **87** | build | M3 |
| B3 | Verify semantic-gap rule: cron/recurring + outbound send + list source with no memory ⇒ error + self-heal auto-inserts dedupe | 85 | 80 | 80 | **82** | build | M2 |
| C3 | RAG nodes: `file-search` (/drive pgvector) + `research-search` (cross-session research facts) | 75 | 85 | 80 | **80** | build | M3 |
| E3 | Memory visibility: canvas "Memory" panel (live data-store keys/values, clear-key) + node badges ("remembers `seen_urls` · 47 items") | 80 | 80 | 80 | **80** | build | M5 |
| A3 | `{{state.KEY}}` template namespace (engine pre-resolves workflow store into node configs) | 80 | 75 | 80 | **78** | build | M1 |
| B8 | Grounding upgrades: always-on state-keys section, site-tool catalog, new-node docs | 75 | 85 | 75 | **78** | build | M2+M3 |
| A5 | WhatsApp node v2: markdown→WhatsApp, length chunking, media via Hermes `/send-media`, idempotency hash-suppress | 80 | 80 | 75 | **78** | build | M3 |
| D1 | Run outcome notifications: per-workflow opt-in failure alert / completion digest to WhatsApp (engine-level, works in worker mode) | 80 | 75 | 80 | **78** | build | M4 |
| B4 | Plan-phase robustness checklist (planner must state re-run behaviour before finalize) | 70 | 90 | 70 | **77** | build | M2 |
| B5 | De-keyword the dedup exemplars; add digest exemplar not gated on "new" | 70 | 90 | 70 | **77** | build | M2 |
| C2 | `llm-agent` v2: opt-in site-tools source (non-destructive allowlist) + timeout/cost capture on sub-calls | 80 | 75 | 75 | **77** | build | M3 |
| A6 | `llm-call` structured output mode (JSON schema, parse + validate) | 75 | 75 | 78 | **76** | build | M3 |
| A9 | Hygiene: backfill missing llmDescriptions (~14 nodes); dryRun guards on blog-create/update + file-write/delete | 65 | 90 | 70 | **75** | build | M3 |
| C4 | `deck-build` node (presentation_build_from_spec) | 65 | 80 | 75 | **73** | build | M3 |
| C5 | Fix broken `jkai` node (stale tool names → build_*) | 55 | 90 | 70 | **72** | build | M3 |
| B6 | Eval: recurring-digest dedup case + two-run idempotency assertion (seeded store) | 65 | 70 | 75 | **70** | build | M2 |
| B7 | Generator through `$lib/llm` resilience gateway (z.ai→OpenRouter fallback) | 65 | 75 | 70 | **70** | build | M2 |
| E1 | Shared canvas shell `$lib/canvas/shell/` (viewport rune module, Minimap, ZoomControls, orthPath) adopted by BOTH canvases; reconciles drift (wheel guard, pinch) | 70 | 60 | 70 | **67** | build | M5 |
| C6 | Media-generate palette presets over site-tool node (image/tts/document) | 55 | 80 | 65 | **67** | build | M3 |
| D2 | Approval-via-WhatsApp: approval pause pings WhatsApp, inbound reply resumes run | 70 | 60 | 65 | **65** | build | M4 |
| D4 | Webhook hardening: per-workflow secret + canvas copy/test affordance | 55 | 70 | 65 | **63** | build | M4 |
| E4 | Cross-canvas parity: desk gains `webpage` node; research group surfaced in workflow palette | 55 | 75 | 60 | **63** | build | M5 |
| A7 | `loop` v2: per-item sub-workflow execution mode (bounded concurrency fan-out) | 70 | 55 | 60 | **62** | build | M6 |
| D3 | `whatsapp-trigger` node: inbound keyword/prefix routes to workflow, else falls through to chat | 60 | 50 | 55 | **55** | build | M6 |
| E5 | Consolidate 3 window-keydown effects into one keymap module | 45 | 60 | 50 | **52** | build | M5 |
| E6 | NodeCard registry split of the 8k-line monolith | 55 | 35 | 45 | **45** | **defer** — standing order | — |
| A8 | `http-request` pagination/cursor-follow mode | 35 | 45 | 45 | **42** | build (descope-eligible) | M6 |
| E7 | Full one-route canvas merge (mode switching) | 65 | 20 | 35 | **40** | **defer** — standing order, north star | — |
| E8 | Run-as-desk artefact streaming (runs render as desk cards) | 50 | 25 | 25 | **33** | **defer** — semantics don't map | — |

## Architecture decisions

- **`{{state.*}}` resolution happens in the engine, not per-executor.** `engine-node-runner`
  walks node config strings before execution, resolving `{{state.KEY}}`, `{{today}}`, `{{now}}`
  from a per-run pre-loaded store snapshot; `{{input.*}}` remains executor-resolved. Namespaces
  are disjoint so there is no double-resolution. Verifier allow-list + generator grounding updated
  in lockstep (the verifier currently hard-rejects non-`input` syntax).
- **Atomicity at the SQL layer.** `add_to_set`/`append`/`increment` are single-statement jsonb
  upserts on `workflow_data_store` (no read-modify-write in JS) because same-level nodes run
  concurrently. The `dedupe` node's filter+record is one CTE.
- **`dedupe` output contract:** `{ items: [...only unseen...], newCount, seenCount, allItems }`,
  passthrough of other upstream keys, `recordMode: 'immediate' | 'downstream-success'` (default
  immediate; downstream-success records only after the run's terminal nodes succeed —
  implemented via engine post-run hook).
- **Destructive gating for `site-tool`:** default deny tools flagged `destructive`; config
  `allowDestructive: true` requires an `approval` node upstream in the same run path (verified at
  save/lint time and enforced at run time), mirroring `scheduled.ts`'s refusal precedent. dryRun
  never invokes destructive tools.
- **Ephemeral-tool escape hatch stays closed:** `author_ephemeral_tool` / `promote_ephemeral_tool`
  and `node_builder_*` are denylisted from the `site-tool` node (arbitrary-code surfaces).
- **Notifications are engine-level** (finally-block on `engine.execute`), not web-process hooks, so
  worker-mode runs alert too. Config = additive nullable `notifications` jsonb column on
  `workflows` (drizzle-push-safe).
- **Webhook secret lives in `workflows.trigger` jsonb** (no schema change); presented once in the
  canvas trigger panel with copy + "send test" affordance.
- **Canvas unification is incremental:** extract the shell library (the two implementations are
  near-verbatim copies already), unify chrome, add cross-surface node parity. The full one-route
  merge and the monolith card-registry split are deferred (standing order below).
- **The live news pipeline gets fixed as final verification:** after deploy, insert a `dedupe`
  node into `dde79bdf` via the workflow API, run twice manually, prove run 2 sends nothing stale.

## Decision Log

| Decision | Options | Chosen | Why | Reversibility |
|---|---|---|---|---|
| Failed understand-phase agents | re-run vs recover from transcripts | recovered StructuredOutput attempts from transcripts | identical content, zero cost | n/a |
| `{{state}}` mechanism | per-executor context threading vs engine pre-resolution | engine pre-resolution of config strings | touches 1 file not ~30 executors; disjoint namespaces | high — additive |
| Dedup shape | delivery-node memory vs standalone dedupe node vs both | standalone `dedupe` node + WhatsApp idempotency hash as last line | composable for any channel; generator can plan it; hash guard catches everything else | high |
| Per-item fan-out | full engine for-each (XL) vs loop→sub-workflow mode (M) | loop v2 sub-workflow mode | 80% of value, reuses existing sub-workflow executor, no engine-walk rewrite | high |
| E6 monolith card split & E7 full merge | build vs defer | **defer** | John's 2026-06-05 standing order: no blind interaction/refactor-heavy monolith changes without a click-through — I cannot click-test OAuth-gated canvas beyond headless smoke | n/a — listed for a supervised session |
| E8 run-as-desk | build vs defer | **defer** | agent-invented; desk semantics (source/fact/entity, synthesis) don't map onto run outputs — low genuine effectiveness (25) | n/a |
| Schema changes | none vs minimal | one additive nullable `workflows.notifications` jsonb | everything else fits existing tables/jsonb | high — nullable column |
| Implementation isolation | worktrees per agent vs sequential milestones on master branch | feature branch `workflow-engine-rethink`, sequential milestone workflows, disjoint-file parallelism within milestones | shared registry hot-spots (index.ts, registry-client.ts, adapter.ts, panels/registry.ts) make parallel worktrees merge-hell | high |
| Generator model | keep glm-5.2 direct vs gateway + stronger model | route through resilience gateway, keep default model configurable (admin default) | fallback fixes outage class; model choice stays John's via /admin/models | high |

## Verification

- Unit: parity tests (registry/palette), new node executor tests, template/state resolution tests,
  atomic-op race test (concurrent add_to_set), verify-rule tests, eval scorer tests.
- `RUN_WORKFLOW_EVAL=1` eval run before/after generator changes (Case 1 + new dedup case).
- `NODE_OPTIONS=--max-old-space-size=8192 npm run check` + full build (sandbox off).
- Headless Playwright smoke on `/jkai/canvas/[slug]` + `/deepdive/[id]` after shell extraction.
- Live: deploy, then fix `dde79bdf` with a dedupe node, trigger 2 manual runs, confirm run 2
  filters previously-seen stories; confirm `{{today}}` resolves in the sent message.
