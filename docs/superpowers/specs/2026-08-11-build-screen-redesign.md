# Build screen redesign — one screen, live controls, mobile

Date: 2026-08-11
Grade: autonomous (full) — self-approved gates, Decision Log below.

## The brief

1. Render on a single page. Today it scrolls up and down, and the width changes
   as iterations accumulate.
2. Surface the Studio machinery — controls, sidecars, prompts, guardrails,
   gates — inside the build screen, explorable and tweakable. Turn the variables
   that currently need a separate Claude session into low/no-code options.
3. Make it work on a phone.

## What is actually wrong

Production serves **V3** (`PUBLIC_BUILDS_V3=true` on the VPS), i.e.
`src/lib/builds/BuildSession.svelte`. V2 (`BuildDetailV2.svelte`) is the local
default, which is why the two disagree.

**The scroll.** `src/routes/jkai/+layout.svelte` already owns the viewport:
`.jkai-root { height: 100dvh; overflow: hidden }` and `.jkai-body { flex: 1;
min-height: 0; overflow-y: auto }`. `BuildSession` then declares
`height: calc(100vh - 1rem)` — the *whole* viewport, ignoring the HubHeader and
the JkaiTabBar above and below it. It is ~130px too tall before any content
exists. On top of that it stacks `BuildCockpit` (four tiles + signals + five
panels) and `IterationInspector` (prompt block, search, action list) as
unbounded flex children with no `flex-shrink: 0` and content-driven
`min-height: auto`. Their combined intrinsic height is several times the
viewport, so `.jkai-body` scrolls — and the terminal stream, the one region
that was *meant* to scroll, gets squeezed to its 200px floor.

**The width.** `.bs-shell` is `max-width: 1400px; margin: 0 auto` inside a
container whose vertical scrollbar appears and disappears as content grows.
Each appearance takes ~15px of available width, and `BuildCockpit`'s
`repeat(auto-fit, minmax(260px, 1fr))` grid reflows its column count when it
crosses a breakpoint. `IterationInspector` also renders nothing until iteration
1 exists and then adds a large block. So: start a build, watch the page jump
width as iterations land. Removing the page scroll removes the cause.

**The missing controls.** `BuildSidebar.svelte` — the only settings UI in the
codebase, and the only thing that PATCHes model / thinking / design-enforcement
/ iteration-approval — is rendered **by V2 only**. V3 never imports it. So in
production there is no way to see or change a build's configuration at all,
which is exactly why debugging a Studio build means opening a separate Claude
session and reading the database.

**The good news.** `Orchestrator.runIteration` re-fetches the build row at the
top of every iteration (`orchestrator.ts:861`). Every knob below is therefore
already live: change it mid-build and the next iteration picks it up. No
orchestrator change is needed to make these real controls — only a UI and a
slightly wider PATCH allow-list.

## Design

A fixed application shell with an internally-scrolling tab body — the same
mechanism the `/jkai` layout already uses one level up. The shell fills its
container exactly, never overflows, and therefore never produces a page
scrollbar, so the width is constant for the life of the build.

```
┌ status rail ────────── pinned, wraps on mobile ┐
│ ← builds · RUNNING · iter 4 · 12m · [Pause]    │
├ preview banner (only when there is a preview) ─┤
├ tabs: Stream Iterations Instruments Controls Blueprint
├ ─────────────────────────────────────────────  │
│                                                │
│   the ONE scrolling region                     │
│                                                │
├ composer (collapsible on mobile) ──────────────┤
└────────────────────────────────────────────────┘
```

Five panes, each already-built content moved into a tab rather than stacked:

- **Stream** — the terminal feed, unchanged (`StreamLine`, `IterationHeader`,
  focus chips).
- **Iterations** — `IterationInspector`, unchanged behaviour.
- **Instruments** — `BuildCockpit`, unchanged behaviour.
- **Controls** — new. The no-code surface.
- **Blueprint** — new. What this build is actually running.

### Controls (new) — what becomes no-code

Everything here is a column on `jkai_builds`, re-read every iteration. Grouped
as John named them:

| Group | Control | Field |
|---|---|---|
| Model | model picker, thinking level | `modelId`/`modelProvider`, `thinkingLevel` |
| Budget | iterations, total minutes, tokens/hour, tokens/iteration, active min/hour, cost cap, idle breaker | `budgetConfig.*` |
| Guardrails | enforce design system, idle-iteration breaker | `enforceDesignSystem`, `budgetConfig.maxIdleIterations` |
| Gates | approve each iteration, plan approval state | `requireIterationApproval`, `planStatus` |
| Toolsets | per-toolset checkboxes from the live registry manifest | `enabledToolsets` |
| Studio | evidence mode; chapter spine editor (n / title / leverId / outcomeId) | `researchMode`, `chapterPlan` |
| Standing instructions | pinned notes, re-injected every iteration | session notes API |

The last row is the answer to "how do I make prompt-level things no-code":
the builder **already** supports notes that are re-injected into every
iteration — it is the `# ` prefix convention buried in the session composer's
placeholder text. Surfacing it as a labelled control turns the one existing
prompt-override mechanism into a discoverable feature instead of a secret.

The chapter-spine editor matters specifically because `studio-gate` drives
`leverId`/`outcomeId` as data attributes; a chapter with no declared pair
cannot be interactivity-checked, and `describeGateSkip` exists precisely
because an empty spine silently disables the whole guardrail. Making the spine
visible and editable is a debugging tool, not a convenience.

### Blueprint (new) — what is read-only

A pipeline diagram of the seven stages a Studio build goes through
(research → plan → skeleton → chapter loop → design lint → studio gate →
publish), each showing live state, plus:

- **Sidecar** — jkai-builder over its Unix socket, and the Codex bridge; live
  reachability, not a stored status column.
- **Prompts** — the actual system prompt and iteration-context template for this
  build's mode (`app` / `repo` / `studio`), read from `prompt.ts`.
- **Guardrails** — the three design-lint rules with what each matches and the
  mount exemptions.
- **Gate** — the five studio-gate checks, the chapters currently due, and the
  live findings.

Read-only deliberately: prompts, lint rules and gate checks live in code and are
shared by every build. Per-build overrides would mean orchestrator changes, and
the orchestrator is under active development in this exact area.

## Files to touch

| File | Why |
|---|---|
| `src/lib/builds/BuildSession.svelte` | M — rewrite the shell: fixed height, tab body, one scroll region |
| `src/lib/builds/BuildControls.svelte` | **NEW** — the no-code control surface |
| `src/lib/builds/BuildBlueprint.svelte` | **NEW** — pipeline / sidecar / prompts / guardrails / gate |
| `src/lib/builds/settings.ts` | **NEW** — pure `sanitiseBuildPatch` + budget field metadata, shared by route and UI |
| `src/lib/builds/settings.test.ts` | **NEW** — unit tests for the validation |
| `src/routes/api/jkai/builds/[id]/+server.ts` | M — PATCH allow-list delegates to `sanitiseBuildPatch` |
| `src/routes/api/jkai/builds/[id]/config/+server.ts` | **NEW** GET — toolset manifest, lint rules, gate checks, prompt text, sidecar health |
| `src/lib/builds/BuildCockpit.svelte` | M — drop the outer margin so it sits in a pane |
| `src/lib/builds/IterationInspector.svelte` | M — same |
| `src/lib/builds/BuildSessionPanel.svelte` | M — becomes a bounded composer, not a growing block |

Explicitly **not** touched, to stay clear of the in-flight Studio work:
`orchestrator.ts`, `executor.ts`, `prompt.ts`, `studio-gate.ts`,
`design-lint.ts`, `studio.ts`. The new config endpoint imports from them; it
does not change them.

## Verification

- `npx vitest run src/lib/builds/settings.test.ts` — PATCH validation.
- `NODE_OPTIONS=--max-old-space-size=8192 npm run check` — types.
- Playwright against the local prod build with `PUBLIC_BUILDS_V3=true`, on a
  real build id:
  - `document.documentElement.scrollHeight <= innerHeight + 1` at 1440×900 —
    the page does not scroll.
  - `.bs-shell` client width identical on a 1-iteration and an 8-iteration
    build — the width does not move.
  - 390×844 (iPhone 12): no horizontal overflow, tab bar reachable, composer
    usable.
- Live: merge to master, wait for CI, screenshot production.

## Decision Log

**D1 — which view.** Options: redesign V3 only / redesign both / merge V2+V3
into one. **Chose V3 only.** It is what production serves; V2 stays untouched as
a working fallback reachable by flipping `PUBLIC_BUILDS_V3`. Fully reversible
and the smallest conflict surface against active Studio commits.

**D2 — layout model.** Options: shrink the existing single column / fixed shell
with tabs / multi-column dashboard. **Chose the fixed shell with tabs.** It is
the only option that answers all three of John's asks with one mechanism, and it
copies the `/jkai` layout's own 100dvh + single-scroll-region pattern rather
than inventing one. A multi-column dashboard is the direct cause of the width
instability on mobile.

**D3 — where controls live.** Options: modal / right rail / tab. **Chose a
tab.** A right rail is what breaks the phone layout and what makes the content
width jump; a modal hides state you want to watch while a build runs.

**D4 — what is editable.** **Chose: DB-backed build columns are editable;
prompts, lint rules and gate checks are read-only.** The editable set is exactly
what `runIteration` re-reads each iteration, so every control is genuinely live
with no orchestrator change. Making prompts per-build editable would require
touching `prompt.ts` and the orchestrator, which are under active development.
Standing instructions (session notes) cover the real need — they are re-injected
every iteration and already implemented.

**D5 — isolation.** Working in a dedicated worktree
(`/home/john/.worktrees-build-screen`, branch `feat/build-screen-redesign`).
The shared main checkout changed branch under this session mid-task, which is
the documented hazard.

**D6 — scope deviation, taken deliberately after review.** The spec said it
would not touch `executor.ts` / `prompt.ts`. Three files outside that boundary
were changed anyway, because a self-review found defects the redesign itself
created or exposed:

- `tool-bridge.ts` — `definitionsForBuild` ended `|| allowedSets.length === 0`,
  so a toolset list that matched nothing handed the agent EVERY tool. Harmless
  while nothing could write such a list; the new Controls panel can, which turns
  a latent fail-open into a reachable one. Every production build stores
  `["all"]` (checked), so removing the fallback changes no existing row.
- `prompt.ts` + `executor.ts` — the design-system block was a string literal
  inside the executor, so the Blueprint's prompt viewer under-reported what the
  agent was told on every design-enforced non-studio build. Moved to `prompt.ts`
  as `DESIGN_SYSTEM_PROMPT_BLOCK` and imported by both. A prompt viewer that
  silently omits a section is worse than no viewer — it answers "why did it do
  that" with the wrong text. One line changed in `executor.ts`.

**D7 — review findings fixed rather than deferred.** A `/code-review high` pass
found eleven issues; all were fixed in this branch, the notable ones being: a
cost cap of `0` was storable and `checkBudget` reads `0` as "no cap" (floor is
now 0.5, empty means no cap); the Controls panel could switch on
"approve each iteration" while V3 had no approve/reject affordance and did not
open SSE for that status (both added); and the poll discarded the `iterations`
half of its response, freezing the iteration count and the whole Iterations
pane at mount-time values for the life of the page.
