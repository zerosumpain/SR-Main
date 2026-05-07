# Curate Engine + UI (Plan B3+B4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land the full curate orchestrator + UI: six-phase state machine, autonomous discovery with streaming, proposal-card approval gate, generate (calls B2's `writeNodeFiles`), live-test runner, and promote pipeline (git commit → merge → `scripts/deploy.sh` → verify). Plus `/jkai/curate` UI: landing page + per-session view (chat, proposal, live-test, promote button). Apple Calendar test scenario should run cleanly end-to-end after this lands.

**Architecture:** Engine module orchestrates phase transitions and dispatches LLM calls. Discovery toolkit is a small set of helper modules (`web`, `context7`, `repo-readers`, `sr-docs-reader`). LLM prompts live in `src/lib/curate/prompts/`. Each phase persists its progress to the `curateSessions` row built in B1. SSE streams chat + discovery narration to the UI. UI is a single Svelte page with subcomponents per phase view.

**Tech Stack:** SvelteKit, Svelte 5 runes, vitest, the existing project LLM gateway (mirroring `src/lib/jkai/llm-client`), Plan B1 lifecycle modules, Plan B2 codegen, Plan A integrations.

**Reference spec:** `docs/plans/curate-experience.md` §3 (lifecycle), §4.5 (discovery toolkit), §6 (Apple Calendar walkthrough).

---

## File structure

### New / modified

```
src/lib/curate/
  engine.ts                          # Phase state machine, queueAction(), advancePhase()
  prompts/
    scope.ts                         # System prompt for the scope-chat phase
    discovery.ts                     # System prompt for autonomous discovery
    propose.ts                       # System prompt for proposal-card generation
  discovery/
    web.ts                           # Wrap WebSearch + WebFetch with discovery-friendly defaults
    context7.ts                      # Wrap context7 MCP for library docs
    repo-readers.ts                  # Read existing nodes + panels for pattern reuse
    sr-docs-reader.ts                # Read internal sr-docs corpus
    index.ts                         # Barrel + DiscoveryToolkit type
  generate.ts                        # Wraps writeNodeFiles, runs npm install + tsc
  live-test.ts                       # Runs spec.llmExamples against the dev server
  promote.ts                         # Pre-flight checks → commit → merge → deploy → verify → cleanup
  llm-client.ts                      # Thin wrapper around project's existing LLM gateway

src/routes/api/curate/
  sessions/+server.ts                # POST: createCuratedSession + scope handshake; GET: list
  sessions/[id]/+server.ts           # GET: session row + state; PATCH not used in v1
  sessions/[id]/messages/+server.ts  # SSE: chat + discovery narration stream + POST: send user message
  sessions/[id]/approve/+server.ts   # POST: advance from awaiting-approval → generating
  sessions/[id]/redirect/+server.ts  # POST: { text } → re-runs discovery with redirect
  sessions/[id]/promote/+server.ts   # POST: kick off promote pipeline
  sessions/[id]/abort/+server.ts     # POST: end session, mark aborted

src/routes/jkai/curate/
  +page.svelte                       # Landing: list sessions + "New curate" form
  +page.server.ts                    # Loader: list active sessions
  [id]/+page.svelte                  # Session view (the main curate UI)
  [id]/+page.server.ts               # Loader: session row

src/routes/jkai/+page.svelte         # MODIFY: add Curate entry to /jkai hub

tests/lib/curate/engine.test.ts      # State machine transitions
tests/lib/curate/promote.test.ts     # Pre-flight checks, dry-run promote against fixture branch
tests/lib/curate/discovery/*.test.ts # Per-tool unit tests where reasonable
```

---

## LLM gateway — read-then-decide

Read `src/lib/jkai/llm-client.ts` (and `src/lib/workflows/nodes/llm-helpers.ts` for the workflow-side wrapper) to see how the project structures LLM calls. Mirror that pattern in `src/lib/curate/llm-client.ts`. Specifically:
- Use the same provider gateway. No direct SDK calls.
- Same prompt-caching / streaming pattern as the autonomous builder uses.
- Pass through model name + system + user messages + tools.

---

## Phase 1 — Engine + state machine

### Task 1: State machine + tests

**Files:**
- Create: `src/lib/curate/engine.ts`
- Test: `tests/lib/curate/engine.test.ts`

Implements:
- `transitionStatus(sessionId, from, to)` — validates the transition is in the allowed graph, updates the row.
- Allowed transitions:
  ```
  scoping        → discovering, aborted
  discovering    → awaiting-approval, error, aborted
  awaiting-approval → generating (approve), discovering (redirect), aborted (reject)
  generating     → live-testing, error
  live-testing   → awaiting-promotion (looks-right), generating (iterate), aborted
  awaiting-promotion → promoting, aborted
  promoting      → promoted, error
  any (with active worktree) → ended (via abort)
  ```
- `getAllowedTransitions(currentStatus): string[]` — useful for the UI to enable/disable buttons.
- All transitions write to `iterationLog` so we get a session timeline for free.

Tests: 5+ cases (valid transition, invalid transition, log entry written, idempotent same-state, aborted from any state).

Per-task commit: `feat(curate): engine state machine`.

---

## Phase 2 — LLM client wrapper + prompts

### Task 2: `src/lib/curate/llm-client.ts`

Thin wrapper over the project's existing gateway. Exposes:
- `streamChat({ system, messages, tools? }): AsyncIterable<{ type: 'text', text } | { type: 'tool_use', ... }>`
- `oneShot({ system, prompt, schema? }): Promise<text | structuredResult>`

Read `src/lib/jkai/llm-client.ts` to see the actual function signatures and copy the patterns. Don't introduce a new gateway abstraction.

Commit: `feat(curate): LLM client wrapper`.

### Task 3: System prompts

Three prompt strings:

- `src/lib/curate/prompts/scope.ts` — "You are scoping a new workflow node. Ask 1-3 targeted questions to nail the outcome. End by writing a one-line goal."
- `src/lib/curate/prompts/discovery.ts` — "You are designing a workflow node from scratch. Tools: web.search, web.fetch, context7.queryDocs, repo.readNode(type), repo.readPanel(componentName), repo.readPackageJson, srDocs.read. **You MUST NOT fall back to the http-request node** — the user wants a first-class purpose-built node. Stream your reasoning as you research; end by emitting a structured proposal."
- `src/lib/curate/prompts/propose.ts` — Schema for the proposal payload (canonical NodeSpec + chosen approach + rejected alternatives + 1-2 example test cases).

Commit per file or one combined commit: `feat(curate): scope/discovery/propose prompts`.

---

## Phase 3 — Discovery toolkit

### Task 4: Web search + fetch wrappers

`src/lib/curate/discovery/web.ts`:
- `webSearch(query): Promise<{ title, url, snippet }[]>` — wraps the existing WebSearch tool/MCP. Caches identical queries within the session so the LLM can re-ask without paying twice.
- `webFetch(url): Promise<{ status, contentType, text }>` — wraps WebFetch.

Commit: `feat(curate): web search + fetch discovery tools`.

### Task 5: context7 wrapper

`src/lib/curate/discovery/context7.ts`:
- `queryLibraryDocs(libraryName, query): Promise<{ excerpts: { source, text }[] }>` — wraps `mcp__plugin_context7_context7__query-docs`. Looks up the library id via `mcp__plugin_context7_context7__resolve-library-id` first.

Commit: `feat(curate): context7 library docs wrapper`.

### Task 6: Repo readers

`src/lib/curate/discovery/repo-readers.ts`:
- `readNode(type): Promise<{ defSource, executorSource } | null>` — reads `src/lib/workflows/nodes/<type>.def.ts` and `<type>.ts`.
- `readPanel(componentName): Promise<string | null>` — reads `src/lib/canvas/nodes/panels/<componentName>.svelte`.
- `readPackageJson(): Promise<{ dependencies, devDependencies }>` — parses the project's package.json.
- `listAvailableNodes(): Promise<string[]>` — globs `src/lib/workflows/nodes/*.ts`.

Commit: `feat(curate): repo-reader discovery tools`.

### Task 7: sr-docs reader

`src/lib/curate/discovery/sr-docs-reader.ts`:
- `srDocsRead(globOrPath): Promise<{ path, content }[]>` — reads from `~/sr-docs/content/internal/features/workflows/`.
- Hard-paths `~/sr-docs` since it's the user's known location; resolves via `os.homedir()`.

Commit: `feat(curate): sr-docs corpus reader`.

### Task 8: Toolkit barrel + DiscoveryToolkit type

`src/lib/curate/discovery/index.ts`:
- Exports a `DiscoveryToolkit` interface that aggregates all the tools.
- Provides a `defaultToolkit()` factory that returns an instance wired up with the real implementations.

Commit: `feat(curate): discovery toolkit barrel`.

---

## Phase 4 — Generate + live-test

### Task 9: Generate wrapper

`src/lib/curate/generate.ts`:
- `runGenerate(sessionId): Promise<{ written: string[]; deps: NodeDep[] }>`:
  1. Loads session row → reads `nodeSpec`
  2. Resolves the worktree dir + sr-docs dir from the session
  3. Calls `writeNodeFiles(spec, worktreeDir, srDocsDir)` from B2
  4. If `spec.deps` non-empty: runs `npm install <pkg>...` in the worktree
  5. Runs `npx tsc --noEmit --skipLibCheck` and reports any errors
  6. Updates session row, transitions status `generating → live-testing`
- Failure modes: dep install fails, tsc fails — both surface to the iteration log.

Test: against a temp worktree using the Apple Calendar fixture spec from B2. Skip the npm install (it's already in the template; mock or fake the call).

Commit: `feat(curate): generate phase wrapper`.

### Task 10: Live-test runner

`src/lib/curate/live-test.ts`:
- `runTestCases(sessionId): Promise<TestCaseResult[]>`:
  1. Reads session's nodeSpec.llmExamples (Apple Calendar's 2-3 cases)
  2. For each example: hits the per-session dev server's workflow-engine API to execute the new node with the example config (engine endpoint must already exist; if not, use a thin wrapper). Captures output.
  3. Returns `[{ scenario, ok, output, error }]`
- Pushes results into `iterationLog` for the UI.
- Does NOT auto-judge "ok" — user decides via UI button.

Test: mocks the dev server response and asserts the right shape comes back.

Commit: `feat(curate): live-test runner`.

---

## Phase 5 — Promote pipeline

### Task 11: Promote pipeline

`src/lib/curate/promote.ts`:
- `runPromote(sessionId): AsyncIterable<{ step, status: 'running'|'ok'|'failed', detail? }>`:
  1. Pre-flight: master clean, no commits ahead, package.json install
  2. tsc on the worktree
  3. Squash-commit the worktree's curate branch
  4. `git checkout master && git merge --ff-only` (or rebase if needed)
  5. `git push origin master`
  6. Run `scripts/deploy.sh`
  7. Verify live: hit `/api/health/workflow-engine` on prod, confirm `<type>` is in the registry
  8. Cleanup: `git worktree remove`, `git branch -D`, mark session `promoted` + `promotedAt`

Surface progress via async iterable so the UI can render a checklist.

Test: dry-run against a temp branch on the dev repo. Skip the deploy (it touches prod). Assert each step runs in order.

Commit: `feat(curate): promote pipeline`.

---

## Phase 6 — API endpoints

### Task 12: Session lifecycle endpoints

- `POST /api/curate/sessions` — body `{ targetType?, initialMessage? }` → creates session, kicks scope chat with the initial message, returns `{ sessionId }`. Spawns the worktree + dev server (B1 lifecycle).
- `GET /api/curate/sessions` — list active sessions (for landing page).
- `GET /api/curate/sessions/[id]` — full session row (for session page loader).

Commit: `feat(curate): session lifecycle API`.

### Task 13: Messages SSE + POST

- `GET /api/curate/sessions/[id]/messages` — SSE stream. Sends:
  - `event: msg` — chat message (user or assistant)
  - `event: discovery` — discovery narration line
  - `event: phase` — phase transition
  - `event: test-result` — test case result
  - `event: promote-step` — promote progress
- `POST /api/curate/sessions/[id]/messages` — body `{ text }` → user reply during scope chat OR redirect/interjection during discovery.

Internally: maintain an in-memory subscriber set per session id. Engine pushes events; SSE connections pop them.

Commit: `feat(curate): SSE messages stream + user input`.

### Task 14: Gate endpoints

- `POST /api/curate/sessions/[id]/approve` — transitions awaiting-approval → generating; engine begins runGenerate in the background.
- `POST /api/curate/sessions/[id]/redirect` — body `{ text }` → re-runs discovery with the user's correction.
- `POST /api/curate/sessions/[id]/promote` — kicks off runPromote.
- `POST /api/curate/sessions/[id]/abort` — calls endCuratedSession + marks aborted.

Commit: `feat(curate): gate transition endpoints`.

---

## Phase 7 — Engine glue: orchestrating the phases

### Task 15: Phase orchestrator

`src/lib/curate/engine.ts` extension:
- `runScopeChat(sessionId, userMessage)` — appends to chat, calls `llm.streamChat(scope-prompt + history)`, persists assistant message. When the assistant emits a goal, transitions to discovering.
- `runDiscovery(sessionId)` — autonomous loop: assistant calls discovery tools, narrates progress, eventually emits proposal payload. Push everything to iterationLog + SSE.
- `runIteration(sessionId, userText)` — for redirect/interjection during discovery: rewinds discovery state, restarts with the redirect appended.

Each of these is async and the engine multiplexes them via the session id.

Commit: `feat(curate): phase orchestrator`.

---

## Phase 8 — UI

### Task 16: `/jkai/curate` landing page

`src/routes/jkai/curate/+page.{server,svelte}.ts` — list active sessions + "New curate" form (just a text input for the goal). Mirrors the look of `/jkai/builds` (read that page for design tokens).

Commit: `feat(curate-ui): landing page`.

### Task 17: `/jkai/curate/[id]` session view

`src/routes/jkai/curate/[id]/+page.svelte` — single page with these regions, conditionally rendered by phase:

- **Header**: session goal + status pill + Abort button
- **Chat panel**: scrolling list of chat messages + input box (active during scoping; disabled during discovering except for redirect)
- **Discovery feed**: a collapsible region that shows streaming discovery lines as they arrive (during discovering)
- **Proposal card**: a structured rendering of the proposal payload (during awaiting-approval) with Approve / Redirect / Reject buttons
- **Live-test panel**: shows test case results as they arrive (during live-testing) with "Looks right" / "Iterate" / Abort buttons
- **Promote checklist**: stepwise checklist of the promote pipeline (during promoting) — the SSE `promote-step` events drive it
- **Promoted summary**: success card with link to the new node in canvas (after promoted)

The page connects to SSE on mount, dispatches user actions to the gate endpoints, and updates local state from incoming events. No router-level loading states — SSE handles everything.

Don't over-design. Functional first; the design tokens (`.nm-sec`, `.nm-text-input`, etc.) keep it visually consistent.

Commit: `feat(curate-ui): session view`.

### Task 18: `/jkai` hub entry

Modify `src/routes/jkai/+page.svelte` — add a "Curate a node" entry next to the existing chat / builds entries.

Commit: `feat(curate-ui): /jkai hub entry`.

---

## Phase 9 — Final verification

### Task 19: Full sweep

- All curate tests pass (`tests/lib/curate/`)
- `tsc --noEmit --skipLibCheck` clean for all curate paths
- Pre-existing baseline (12 failures) unchanged
- `/jkai/curate` renders in `npm run dev` (HTTP 302 → /login is fine — auth gate)

If anything's tweaked: commit `chore(curate): final-sweep cleanup`.

---

## Self-review

- [ ] All tasks committed individually
- [ ] State machine has tests for all transitions (valid + invalid)
- [ ] Discovery prompt explicitly forbids http-request fallback
- [ ] LLM client uses the project's gateway (not direct SDK)
- [ ] SSE handler cleans up subscribers on disconnect
- [ ] Promote pipeline is wholly transactional or has clear rollback at every step
- [ ] No `console.log` (allow `console.error` in promote.ts step failures)
- [ ] All new routes are auth-gated (inherited via existing `hooks.server.ts`)

---

## Out of scope (deferred to follow-ups)

- Sandbox API probe during discovery (uses jkai-sandbox; cost not justified for v1)
- Concurrent multi-iteration optimization
- Drag-and-drop the new node into a canvas immediately after promotion
- Re-curation / editing existing curated nodes

---

## Notes for the executing agent

- **Heavy reading required upfront.** Before writing the engine, read `src/lib/jkai/orchestrator.ts` and `src/lib/jkai/llm-client.ts` to see how the autonomous builder structures phase orchestration + LLM calls. Mirror that pattern.
- **SSE in SvelteKit**: use `event-stream` content-type + `ReadableStream` controller. There are existing SSE endpoints in the project; grep for `text/event-stream` to find one to crib from.
- **The LLM model**: use the project default unless there's a strong reason. The orchestrator system prompt is responsible for the heavy lifting; keep model choice simple.
- **Test-driven where reasonable**: state machine + promote pre-flight benefit; LLM-driven discovery doesn't have unit tests (it'd be testing the LLM, not us).
- **If something's not clear**: ask. Don't guess — this plan trades brevity for clarity, but corner cases are inevitable.
