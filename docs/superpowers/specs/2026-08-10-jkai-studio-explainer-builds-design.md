# jkai Studio — autonomous, explorable learning projects

**Date:** 2026-08-10
**Status:** design, awaiting review
**Owner:** John

## Problem

John currently learns new topics by co-designing bespoke projects with Claude Code in an
interactive session. `/projects/policy-engine` is the reference output: 126 files, 22,521
lines, 15 pages, with a real simulation engine (`lib/engine.ts`, `lib/levers.ts`,
`lib/evidence.ts`) behind it.

He wants jkai to produce artefacts of that class autonomously from a challenge statement —
multi-page, visually driven, interactive, and genuinely *explanatory* rather than merely
attractive. The reference experience he cited describes policies, processes and concepts
through a low-poly, SimCity-like scene.

jkai cannot currently do this, for four specific reasons.

### 1. The system prompt optimises for shallowness

`src/lib/jkai/prompt.ts` (`SYSTEM_PROMPT`, app mode) instructs the agent:

- *"SCOPE OF AN ITERATION — SHIP THE THINNEST RUNNABLE PREVIEW, THEN WRAP"*
- *"Target 5–15 minutes per iteration, not 30. Finishing early is a feature."*
- *"HARD STOPS (end the iteration NOW): You have a working serve.json, the server starts, and
  at least one route returns a 200. → Wrap up."*
- *"Prefer breadth-first: a running skeleton with 3 empty pages beats one perfect page."*

That prompt was correctly tuned for a different goal — getting a clickable preview in front of
the user fast. It structurally cannot produce a policy-engine.

### 2. The design-system mount teaches the blandness the critic then penalises

`src/lib/jkai/design-assets.ts` mounts one worked example: `examples/page.svelte`, an admin
list page with status dots and a card grid. Meanwhile `CRITIC_SYSTEM_PROMPT` in `planner.ts`
is told to flag `BLAND:` for *"generic dashboard/list page"* output. The system demonstrates
the thing it punishes.

Compounding it, `SYSTEM_PROMPT` says *"Tailwind via CDN is the default for quick design"*
while `design-lint.ts`'s `no-tailwind` rule rejects `bg-*`, `text-*`, `p-N`, `m-N`, `flex` and
`grid`. Three iterations of unfixed findings aborts the build as `design_lint_loop`.

### 3. There is no research stage

`planner.ts` runs proposer → critic → revision entirely on model priors. A `research` toolset
(12 tools: `research_start`, `research_status`, `research_get_report`, `research_extract`,
`research_web_search`, `research_query`, `research_branch`, …) exists and is reachable over
the tool bridge, but nothing in the build pipeline ever calls it. The whole sourcing policy is
one prompt line: *"Use real data."*

This matters beyond accuracy. Per `reference_llm_fabrication_pattern`, merging LLM output
destroys provenance; the fix that worked elsewhere on this site was an explicit FACTS/GAPS
structure.

### 4. No visual vocabulary exists

Nothing tells the agent that three.js is an option, there is no asset pipeline, and no scene
grammar. The plumbing is already there and unused: `src/routes/projects/[slug]/[...path]/+server.ts`
serves `.glb` and `.gltf` MIME types today.

## Decisions taken

| Question | Decision |
|---|---|
| Where projects live | Standalone bundles at `/projects/<slug>/` (jkai's existing app-build path) |
| Visual approach | A vendored explainer kit with several modes; jkai picks per concept |
| What makes it *learning* | Explain → manipulate → consequence, enforced by a check, not a prompt line |
| Autonomy and spend | Challenge statement in, live project out; deeper caps; hard cost cap as backstop |

## Approach

A new build **mode**, not a new subsystem. `forge.ts` is the precedent: a preconfigured build
creator plus a dedicated prompt mode plus its own guardrails, sharing the whole existing
builder pipeline. Studio mirrors that shape exactly.

```
challenge statement
   │
   ├─ research stage        (NEW)  research toolset → FACTS/GAPS brief, stored on the build
   │
   ├─ planner               (EXTENDED) brief injected; chapter-oriented iterations;
   │                                   critic gains PEDAGOGY + SOURCING dimensions
   │
   ├─ iterations 1..N       (NEW PROMPT MODE) explainer kit mounted; one complete
   │                                          chapter per iteration after the skeleton
   │
   ├─ per-iteration gates   design-lint (existing) + static-smoke (existing)
   │                        + studio-gate (NEW)
   │
   └─ publish               existing static publish to /projects/<slug>/
```

### Component 1 — Explainer kit

**Location: `static/explainer-kit/`.** Not `packages/` — CLAUDE.md records that `ci-deploy.sh`
never syncs `packages/`. Not a new `src/lib/` directory either, because
`reference_ci_deploy_scripts_allowlist` records that anything read from disk at runtime needs
its own rsync line in the allow-list, and a fail-soft feature cannot report being undeployed.
`static/` is copied into `build/client/` by the adapter, and `build/` is rsynced wholesale by
`ci-deploy.sh` line 35. Zero allow-list change, no silent-undeploy failure mode.

Mounted read-only into the sandbox workspace beside `design-system/`, via the existing
`syncDesignAssets` → `skillDirs` mechanism in `executor.ts`.

Contents:

- `three.min.js` — pinned, vendored. Not a CDN tag: a published bundle under
  `/projects/<slug>/` must not depend on a third party staying up, and a pinned copy is
  reproducible across rebuilds.
- `lowpoly.js` — the SimCity vocabulary. Tile grid, extrudable blocks, isometric camera rig,
  orbit constraints, colour ramps bound to design tokens, click-to-inspect on a tile.
- `diagram.js` — causal/system diagrams: nodes, weighted edges, animated flow along an edge.
  **Ported from `src/routes/projects/policy-engine/components/CausalFlow.svelte`** (424 lines),
  not invented.
- `sim.js` — the lever runtime. Declare parameters and a step function; it renders the
  controls and a live outcome readout. **Generalised from `policy-engine/lib/engine.ts` and
  `lib/levers.ts`**, not invented.
- `chart.js` — data-viz primitives following the `dataviz` skill's palette rules.
- `tokens.css` — explainer palette, derived from the site tokens so `no-raw-hex` still holds.
- `README.md`, `scenes.md` — the grammar, mirroring the existing `components.md` cheatsheet.

Two of the four modules are extractions from a project John already judged good. That is the
point: precedent over invention.

### Component 2 — Explainer design mount replaces the admin mount

Rather than switching `enforceDesignSystem` off for studio builds (which would lose the
`no-raw-hex` and `no-raw-font` discipline), `design-assets.ts` gains a studio variant. Same
linter, different worked example: a chapter page with a scene, a lever panel and a citation
block, instead of an admin list page.

This is the actual fix for problem 2. The linter was never wrong; the reference was.

**Regression guard, learned the hard way:** on 2026-08-09 a build whose app was complete and
serving 200 at iteration 1 died at iteration 3 because `examples/page.svelte` ships
`<div class="grid">`, which `no-tailwind` matches, on a mount the agent is forbidden to edit —
findings stuck at 1 → 1 → 1. `DESIGN_MOUNT_RE` in `design-lint.ts` must cover the explainer
mount too, and the studio example must be linted in CI against the very rules it teaches.

### Component 3 — Research stage

New `src/lib/jkai/research-brief.ts`, running once before the planner.

Calls the existing `research` toolset on the challenge statement and produces a brief with a
**FACTS / GAPS** structure, because a flat merged summary loses provenance:

- **Facts** — 8–15 claims, each carrying its source URL and a one-line quotation or figure.
- **Concepts** — the 3–5 ideas that are genuinely hard, with why each is hard.
- **Causal map** — the relationships between those concepts. This is what `sim.js` and
  `diagram.js` consume; without it the agent invents a model.
- **Live data** — real datasets and APIs available for this topic, named and reachable.
- **Misconceptions** — what a learner typically gets wrong. Chapters are built to confront these.
- **Gaps** — what could not be sourced, stated plainly rather than smoothed over.

Stored as `researchBrief` jsonb on `jkai_builds`, injected into the planner and into every
iteration's context. A claim rendered in the app that does not trace to a fact in the brief is
a studio-gate finding.

### Component 4 — Planner changes

1. Inject the brief into proposer and critic.
2. Chapter-oriented iteration template. Iteration 1 stays a walking skeleton — that rule is
   genuinely good and proves the deployment loop — but it now also lays down the real
   navigation shell and the full chapter inventory as empty routes. Iterations 2..N deliver
   **one complete chapter each**: narrative, its visual mode, its interactive model, its
   citations. **Target 6–10 chapters**, one per iteration, leaving headroom under the
   20-iteration cap for the skeleton, gate-driven repairs and a final polish pass.

   **Chapter contract.** Every chapter route renders a root element carrying
   `data-chapter="<n>"`, and declares its own control and outcome selectors in a
   `chapterPlan` entry on the build row. This is not decoration — it is the interface
   studio-gate drives. Without a declared control/outcome pair the interactivity check has
   nothing to click, and a check that cannot run is a check that silently passes.
3. Two new critic dimensions alongside the existing seven:
   - **PEDAGOGY** — does each chapter have explain → manipulate → consequence? Is the sequence
     a real learning progression, or topic buckets in arbitrary order? Flag `NO-MODEL:` and
     `ARBITRARY-ORDER:`.
   - **SOURCING** — is every claim traceable to a fact in the brief? Flag `UNSOURCED:`.

### Component 5 — studio-gate

New `src/lib/jkai/studio-gate.ts`, running post-iteration beside design-lint and static-smoke.
This is the repeatable-guardrail layer, and it is what makes the outcome reliable rather than
lucky.

| Check | Method | Failure |
|---|---|---|
| Page inventory | Every chapter the plan declares is reachable and returns 200 | names the missing route |
| Interactivity | Drive the declared control selector, assert the declared outcome selector's text changes | names the control that did nothing |
| Visual mode | Each chapter renders at least one `<canvas>` or `<svg>` from the kit | names the prose-only chapter |
| Sourcing | Each chapter renders ≥1 citation resolving to a brief URL | names the uncited chapter |

Implemented on `static-smoke.ts`'s existing headless-Chromium harness, and inheriting its most
important property: **a harness that could not run reports `ran: false`, never `passed: false`.**
A broken harness reporting a failing app blocks good work and teaches the model to route
around the tool.

**Every finding must be fixable and must name its remedy.** The `design_lint_loop` incident is
the standing lesson: an unfixable finding repeated three times kills a build that was actually
finished.

### Component 6 — Budget and model routing

Studio default budget:

```ts
{ maxIterations: 20, maxTotalMinutes: 480, maxTokensPerHour: 3_000_000,
  activeMinutesPerHour: 50, maxCostUsd: 15 }
```

The tokens/hour rise from 1M is load-bearing. `budget.ts` counts *every* iteration in the
window, including failed ones — correctly, after build #126 spent 3.08M tokens across three
iterations while only the one completed iteration's 490k was visible. But a chapter is a large
unit of work; at 1M/hour a single 800k chapter puts the build to sleep for the rest of the
hour. Three chapters would be three hours of mostly sleeping.

`maxCostUsd: 15` is a first guess, not a measured figure — a deep git-target iteration has run
to ~1.5M tokens, so a 20-iteration studio build is plausibly £5–£20 depending on model. Treat
the first three builds as the calibration and adjust.

**Model routing — recommended split rather than a blanket Codex default.** CLAUDE.md warns
that Codex costs ~10s on a first tool call and ~3s on follow-ups because each turn starts a
fresh process, and that a long builder chain will crawl. Twenty deep iterations is the longest
chain this site runs. So:

- **Research and planner stages → Codex.** Few tool calls, no cash cost, quota well spent.
- **Iterations → OpenRouter,** with `maxCostUsd` as the hard backstop.

Flagging this because the decision taken was "Codex default with OpenRouter fallback"; the
split is a deliberate narrowing of that, and it is reversible by config.

The 300-second per-command cap stays. It is a limit of the agent runtime, not a setting.

### Component 7 — Autonomy entry points

`src/lib/jkai/studio.ts`, mirroring `forge.ts`: `createStudioBuild({ challenge })` inserts the
row with `origin: 'studio'`, the studio budget, `planStatus: 'approved'`, the studio prompt
mode and the model split, then hands off to `builderClient.startBuild`.

Reachable from an owner-gated `POST /api/jkai/studio`, a `studio_build` site tool so chat can
start one, and the builds UI.

## Files to touch

**New**

| File | Why |
|---|---|
| `src/lib/jkai/studio.ts` | build creator, mirrors `forge.ts` |
| `src/lib/jkai/research-brief.ts` | research stage, FACTS/GAPS brief |
| `src/lib/jkai/studio-gate.ts` | inventory / interactivity / visual / sourcing checks |
| `src/lib/jkai/studio-gate.test.ts` | parsing and finding-fixability tests |
| `src/lib/jkai/research-brief.test.ts` | FACTS/GAPS parse, source attribution |
| `static/explainer-kit/**` | vendored three.js + lowpoly, diagram, sim, chart, tokens, docs |
| `src/routes/api/jkai/studio/+server.ts` | owner-gated create endpoint |
| `src/lib/workflows/site-tools/tools/studio.ts` | `studio_build` tool for chat |

**Modified**

| File | Why |
|---|---|
| `src/lib/jkai/prompt.ts` | `STUDIO_SYSTEM_PROMPT`; extend `BuildPromptMode` to `app \| repo \| studio` |
| `src/lib/jkai/planner.ts` | brief injection, chapter template, PEDAGOGY + SOURCING |
| `src/lib/jkai/executor.ts` | select studio mode, mount the kit, run studio-gate |
| `src/lib/jkai/design-assets.ts` | explainer variant of the mount |
| `src/lib/jkai/design-lint.ts` | exempt the explainer mount from all three rules |
| `src/lib/db/schema.ts` | `researchBrief` jsonb, `chapterPlan` jsonb, `origin` enum + `'studio'` |
| `src/routes/jkai/builds/new/+page.svelte` | studio option in the UI |

Fourteen files for a subsystem that mirrors an existing one.

**Correction to Component 1, found while planning:** the *kit* needs no allow-list change, but
the gate runner does. `studio-gate.ts` cannot import Playwright directly — `import('playwright')`
resolves from the importing script's own directory, which is why `static-smoke.ts` shells out to
`scripts/smoke-static-app.mjs` and why that file has its own rsync line at `ci-deploy.sh:61`.
`scripts/studio-gate.mjs` needs the same. Without it the gate is absent in production, reports
`ran: false`, and every build sails through unchecked — a fail-soft feature that cannot report
being undeployed, which is precisely the trap `reference_ci_deploy_scripts_allowlist` records.

## Verification

Stated before any code is written.

**Unit** — `npx vitest run src/lib/jkai/studio-gate.test.ts src/lib/jkai/research-brief.test.ts`

**Schema** — `npx drizzle-kit push`. Note `reference_drizzle_unique_push_gotcha` and
`reference_drizzle_push_rename_prompt`: these are three additive nullable columns plus an enum
value, so no rename prompt and no unique-on-populated-table hazard.

**End-to-end** — run one real studio build from a challenge statement, then:

```bash
curl -s https://strangeramblings.com/projects/<slug>/ | grep -c 'data-chapter'   # >= 5
curl -s -o /dev/null -w '%{http_code}' https://strangeramblings.com/projects/<slug>/chapter-3/
```

plus a headless screenshot of a chapter carrying a 3D scene.

**Negative test — the one that actually matters.** A build that ships prose-only chapters must
be rejected by studio-gate with a finding naming the chapter and its remedy, and must recover
on the following iteration. If it cannot recover, we have rebuilt `design_lint_loop`.

## Phasing

**Phase 1 — produce something.** Explainer kit, `STUDIO_SYSTEM_PROMPT`, `studio.ts`, the
explainer design mount. Enough to run a real build and look at what comes out.

**Phase 2 — read the output, then guard.** Run one build on a real challenge statement.
Guardrails written against observed failure modes beat guardrails written against imagined
ones — and the two most valuable checks in the existing system (`static-smoke`, the tool-bridge
preflight) were both written after watching a specific failure.

**Phase 3 — research and planner.** Brief stage, chapter template, PEDAGOGY + SOURCING.

**Phase 4 — studio-gate, budget tuning, chat and UI entry points.**

## Risks

| Risk | Mitigation |
|---|---|
| Unfixable gate finding kills a finished build | Every finding names a file and a remedy; kit mount exempt from design-lint; negative test is a release requirement |
| 20 deep iterations on Codex crawl | Model split — Codex for research/planning, OpenRouter for iterations |
| Vendored three.js drifts or bloats the bundle | Pinned version, size recorded, kit shipped via `static/` so it rides `build/` |
| Research toolset returns thin results | GAPS section is mandatory output; a brief with more gaps than facts stops before the planner rather than fabricating a syllabus |
| Explainer kit becomes a framework nobody asked for | Two of four modules are extractions from policy-engine; anything not traceable to a working precedent is cut |

## Out of scope

- Porting studio output into in-repo SvelteKit routes ("graduate the best" was considered and
  not chosen).
- Assessment and progress tracking. Explain → manipulate → consequence was chosen over
  explicit assessment; revisit once a few projects exist.
- Any change to repo-mode or Forge builds.
