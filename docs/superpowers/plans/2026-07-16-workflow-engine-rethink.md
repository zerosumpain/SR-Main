# Workflow Engine Rethink — implementation plan (2026-07-16)

Spec: `docs/superpowers/specs/2026-07-16-workflow-engine-rethink.md`.
Branch: `workflow-engine-rethink` off `master` (merge → master at ship).
Execution: sequential milestone Workflows, Opus implementation agents, Fable 5 planning/review
between milestones. Registry hot-spots (`workflows/index.ts`, `registry-client.ts`,
`canvas/adapter.ts`, `panels/registry.ts`) are single-writer per milestone.

Every new/changed node follows the workflow-node skill checklist: `.def.ts` + executor,
register in `index.ts` AND `registry-client.ts`, panel (basicConfig or bespoke), palette entry,
llmDescription/llmExamples, parity tests green.

## M1 — Memory & template core (A1, A2, A3, A4)
- `nodes/data-store.ts/.def.ts`: ops `append`, `add_to_set` (atomic single-statement jsonb upsert),
  `has`, `increment`, `delete`, `get` gains `default` + `passthrough` (merge upstream input into
  output); fix invalid `{{trigger.output.*}}` llmExample; DataStorePanel updated.
- NEW `nodes/dedupe.ts/.def.ts` + panel: config `{ idExpression | idPath, storeKey, maxRemembered,
  recordMode }`; output `{ items, newCount, seenCount, allItems }` + passthrough; atomic CTE
  filter+record; `recordMode: 'downstream-success'` via engine post-run hook; dryRun = filter
  without recording; rich llmDescription/llmExamples (news-digest example).
- `engine-node-runner.ts`: pre-resolve `{{state.KEY}}`, `{{today}}`, `{{now}}` in node config
  strings from a per-run store snapshot loaded at run start (+ after each data-store/dedupe write,
  refresh snapshot). Emit `node_warning` run event listing unresolved `{{…}}` tokens after
  executor-level interpolation (post-hoc scan of resolved config), instead of silent passthrough.
- `orchestrator/verify.ts`: allow `{{state.*}}`/`{{today}}`/`{{now}}`; new WARNING for unknown
  template vars in any string config.
- Tests: data-store atomic ops (incl. concurrent add_to_set race via Promise.all), dedupe
  filter/record/passthrough/dryRun, state-resolution, unknown-var warning, parity.

## M2 — Generator robustness (B1–B8 part)
- `orchestrator/prompts.ts`: minimalism carve-out ("state/dedup nodes that make a recurring
  workflow idempotent are load-bearing, never bloat"); hard rule for recurring+send shapes; critic:
  remove "redundant data-stores" from the bloat list; add MISSING-severity dedup check; plan-phase
  robustness checklist (planner states re-run behaviour before finalize).
- `orchestrator/patterns.ts`: de-keyword Scrape-Diff-Notify; add "recurring digest" golden exemplar
  (news→WhatsApp WITH dedupe node) not gated on "new".
- `orchestrator/verify.ts`: `detectSemanticGaps` — recurring trigger + outbound send node +
  list-producing source with no dedupe/data-store ⇒ error; self-heal can auto-insert dedupe.
- `orchestrator/index.ts`: route LLM calls through `$lib/llm` resilience gateway (keep admin-model
  resolution); grounding gains always-on workflow state-keys section.
- `eval/cases.ts`+`assertions.ts`+`run-eval.ts`: Case 1 expectation gains dedupe/data-store
  requirement; new dedup case ("daily news briefing to WhatsApp" — no "new" keyword); two-run
  idempotency assertion (seeded store, second run must emit 0 stale sends).
- Tests: verify-rule unit tests, eval scorer tests. (Full RUN_WORKFLOW_EVAL run happens in M7.)

## M3 — Site capability bridge (C1–C6, A5, A6, A9)
- NEW `nodes/site-tool.ts/.def.ts` + bespoke panel (toolset-grouped tool picker via
  `getToolsetManifest`, args editor with template support, destructive gating per spec, denylist
  ephemeral/node-builder tools, dryRun-aware); lazy-import registry (circular-init hazard).
- `nodes/llm-agent.ts`: opt-in `toolSource: 'edges' | 'site-tools'` with allowlist config;
  sub-calls wrapped in `withNodeTimeout` + `executionContext.run` (cost capture).
- NEW `nodes/file-search` + `nodes/research-search` (thin wrappers over `searchFiles` /
  `searchResearch`), NEW `nodes/deck-build` (presentation_build_from_spec; NOT the destructive
  update tool). Palette presets for media-generate via site-tool node.
- `nodes/jkai.ts`: fix stale tool names → `build_create/build_list/build_control/build_inspect`.
- `nodes/whatsapp.ts/.def.ts`: markdown→WhatsApp translation, >4096-char chunking, optional media
  path (Hermes `/send-media` via existing `sendAttachment`), idempotency hash-suppress
  (`suppressDuplicateWindow`, hash in workflow_data_store).
- `nodes/llm-call.*`: `outputSchema` config → JSON response_format + parse/validate/retry-once.
- Hygiene (A9): llmDescriptions for llm-call, code-execute, delay, openrouter, quick-answer, email,
  whoop, strava, intel-query, intelligence, inspector, manual-trigger, trigger, chat; dryRun guards
  in blog-ops create/update + file-ops write/delete.
- Grounding: site-tool catalog (name, toolset, one-liner, destructive flag) + new node docs.
- Tests: site-tool gating (destructive w/o approval fails at lint + run), agent sub-call timeout,
  chunking/markdown, structured-output parse, dryRun guards, parity.

## M4 — Notifications, approvals, webhooks (D1, D2, D4)
- Schema: additive nullable `notifications` jsonb on `workflows` (drizzle push local BOTH DBs per
  the local-Postgres gotcha; prod via deploy).
- `engine.ts` finally-hook → `run-notifications.ts`: on failure (default when enabled) and/or
  completion digest, send via WhatsApp service or chat push; include workflow name, status, error
  or terminal-node summary + canvas link. Works in worker mode (no web-process dependency).
- Canvas: notifications toggle UI in workflow settings area (small, additive).
- Approval-via-WhatsApp: when an approval node pauses a run and notifications are enabled, send
  "reply APPROVE <code> / DENY <code>"; inbound hook in `whatsapp/orchestrator-bridge.ts` matches
  the code before falling through to generalChat, resolves the interaction via existing
  engine-resume machinery.
- Webhook: optional `secret` in `workflows.trigger` jsonb; route rejects mismatched
  `X-Webhook-Secret` when set; trigger panel shows URL + copy button + "send test" (fires a sample
  POST) + secret management.
- Tests: notification hook (mock service), approval-code parsing (idempotent, expiring), webhook
  secret accept/reject.

## M5 — Canvas unification & memory visibility (E1, E3, E4, E5)
- Extract `$lib/canvas/shell/`: `viewport.svelte.ts` (pan/zoom/screenToWorld/fit/reset/zoomAt,
  wheel + pointer + pinch, scrollable-child guard), `Minimap.svelte`, `ZoomControls.svelte`,
  `orth-path.ts` (box-accessor param). Adopt in BOTH `jkai/canvas/[slug]/+page.svelte` and
  `ResearchDesk.svelte`; reconcile drift (desk gains wheel guard + pinch). Preserve the documented
  Svelte-5 patterns ($state.raw hot stores, no-handle-in-$state, untrack on prop sync).
- Memory visibility (E3): toolbar "Memory" panel — GET `/api/workflows/[id]/data-store` lists
  keys/values/updated, per-key clear with confirm (DELETE endpoint); node badges on
  data-store/dedupe cards ("remembers `<key>`", live count via existing observability stream).
- Parity (E4): `webpage` registered for desk palette (deskOnly-compatible); research group
  (deep-research, research-result, file-search, research-search) surfaced with curated palette
  entries in the workflow canvas.
- Keymap (E5): one `keymap.ts` module, single window listener, ordered handlers; migrate the 3
  window keydown effects + run-summary Escape.
- Tests: shell unit tests (pure math), palette parity, upstream-collision suite still green;
  headless Playwright smoke: canvas loads, pan/zoom applies transform, desk loads, minimap renders
  (auth via local-qa harness patterns).

## M6 — Long tail (A7, D3, A8) — descope-eligible per autonomous-build rule
- `loop` v2: `mode: 'map' | 'subworkflow'` — per-item sub-workflow invocation, bounded concurrency,
  per-item results + failure policy.
- `whatsapp-trigger` node + bridge hook: keyword/prefix match dispatches workflow (input = message),
  else falls through to generalChat, mirroring gmail-trigger matching.
- `http-request` pagination: `pagination: { mode: 'cursor'|'page', cursorPath, pageParam, maxPages }`.
- Tests per feature; parity.

## M7 — Review, ship, live verification
1. Full adversarial multi-lens review Workflow over the whole branch diff; fix confirmed findings.
2. `npm test` full, `npm run check` (heap flag), eval run (RUN_WORKFLOW_EVAL=1) — compare Case 1 +
   dedup case pre/post.
3. Build (sandbox off), merge → master, push, `scripts/deploy.sh`, restart homeserv always-on
   service, verify live (curl + logs).
4. Fix `dde79bdf` live: add dedupe node between tavily and llm-call (+ `{{today}}` now resolving),
   two manual runs, confirm second run filters seen stories.
5. Memory files + final report (scores table, Decision Log, deferred items).
