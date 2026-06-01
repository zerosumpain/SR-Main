# Brass & Rails — Three-Part Refactor (Game · Lab · Forge)

- **Date:** 2026-06-01
- **Status:** Design approved; ready for implementation planning (Phase 0+1 first)
- **Author:** John Kelly (with Claude)
- **Scope:** Refactor the single-file game `~/brass-and-rails.html` into a multi-file, Vite-built project in its own git repo, split across three surfaces (Game / Lab / Forge), and integrate an autonomous-extension capability that reuses the existing jkai-builder engine.

---

## 1. Context & problem

Brass & Rails is currently **one self-contained 4,246-line / 288 KB HTML file** (`~/brass-and-rails.html`, deployed as `static/projects/brass-and-rails/index.html`). It mixes three concerns that have grown to fight each other:

1. **The playable game** — wants to be lean and fast (for both human play and quick AI-vs-AI run-throughs).
2. **The Sandbox Lab + analytics + balance tuning** — the BAL dials, the Houses (per-faction) tab, the headless batch sim, the analytics screen. This has become a substantial sub-application in its own right.
3. **Extension/maintenance** — today this is hand-editing a 4k-line file. There is no version control granularity, no autonomous/scheduled improvement path, and no machine-checkable guardrails.

The single-file constraint that once made the project simple now makes it hard to maintain, hard to review changes to, and impossible to extend safely or autonomously.

**Goal:** split into three clean parts and add a safe, gated, git-based extension pipeline.

---

## 2. Locked decisions

These were settled during brainstorming and are the foundation of the design:

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Code structure | **Multi-file + Vite build step** | Cleanest Game/Lab separation; small files → reviewable diffs → far safer autonomous edits. The jkai sandbox and deploy already provide a build step. |
| D2 | Source location & VCS | **Own git repo `~/brass-and-rails/`; jkai operates on branches** | Real git (commits, tags, branches). jkai extends on a worktree/branch behind a gate, proposes a PR; human merges. Strongest VCS + safety. John still hand-edits directly. |
| D3 | Lab data model | **Client-side sims + git-committed baselines** | Sims run in-browser on the shared engine core; session history in IndexedDB; "official" baselines are committed JSON → git history *is* the trend record. No backend. Same engine runs headless in Node for the gate. |
| D4 | Merge policy | **Always human review** | Every jkai change — prompted, scheduled, or autonomous — lands as a branch/PR the human approves. The gate decides eligibility to *propose*; nothing ships unattended. "Autonomous" = autonomously proposes, not ships. |
| D5 | Part-3 mechanism | **Reuse the jkai-builder engine + sim harness, exposed via a dedicated repo-scoped "Forge" page; hard-scoped to this repo** | Not generalizing the site-wide `/jkai/builds` UI. The game gets its own forge that borrows the builder's machinery and can only touch this repo. |
| D6 | Deploy boundary | **Game public; Lab public read-only / editable when authed; Forge private (homeserv-only)** | The Lab is fully client-side so it can ship publicly (view-only for anon, editable for authed John). The Forge needs server-side builder execution, so it is a homeserv-local tool only. |

---

## 3. Target architecture

### 3.1 The shape

One git repo, one shared engine core, **three built pages** that differ by what they include and where they run:

| Page | File | Audience | Runs where | Includes |
|------|------|----------|-----------|----------|
| **Game** | `index.html` | public | anywhere (static) | engine + render + lean play UI |
| **Lab** | `lab.html` | public read-only / John editable | anywhere (client-side) | engine + sim + analytics + dials |
| **Forge** | `forge.html` | John only | homeserv (needs builder) | thin client → scoped builder API |

### 3.2 Repo & module structure

```
~/brass-and-rails/                  (new git repo)
  src/
    engine/    world-gen, economy, combat, territory, turn-loop   (PURE logic — no DOM/THREE)
    ai/        genome, archetypes, learning, decision utility      (PURE logic)
    sim/       headless batch runner (runs in Node AND browser)    (PURE logic)
    shared/    BAL, FACTION_CFG, UNIT_CFG, COUNTERS, types, defaults
    render/    THREE scene, tilt-shift post-process, tile meshes
    game/      lean play UI            -> index.html
    lab/       analytics + dials       -> lab.html
    forge/     build console (thin client) -> forge.html
  bench/       baseline-*.json (committed; git = trend history)
  gate/        gate runner + design-lint + invariant checks
  scripts/     deploy.sh, etc.
  DESIGN.md    inviolable design principles (human- + machine-readable)
  vite.config.* (multi-page: index, lab, forge)
  package.json  scripts: dev, build, sim, gate, deploy
```

**The crucial invariant:** `engine/ + ai/ + sim/ + shared/` are **pure logic with zero render/DOM/THREE dependencies**. This is what makes:
- fast headless AI-vs-AI run-throughs (no render cost),
- a trustworthy gate (Node runs the identical code the browser runs),
- the Game lean (it pulls `engine + ai + render`, never `sim`/`lab`/`forge`).

The existing headless harness (`/tmp/br_harness2.mjs` + stubs) is the prototype of `src/sim/` — it becomes a real, committed module rather than a throwaway script.

### 3.3 Config objects (the tuning surface)

The mutable, dynamically-read config pattern already in use stays and grows:

- `BAL` / `BAL_DEFAULTS` — global balance dials (existing).
- `FACTION_CFG` / `FACTION_CFG_DEFAULTS` — per-house dials, incl. bonuses, free starting units, archetype (existing — the Houses tab).
- **`UNIT_CFG` / `UNIT_CFG_DEFAULTS` — NEW** — per-unit performance: attack / defence / move / cost / counter bonuses / gating. This is the "extend it to changing performance of units" requirement.
- `COUNTERS` — the counter matrix (existing).

All read **dynamically** (never destructured into module-load consts) so live tuning and gate experiments take effect.

---

## 4. Part 1 — the lean Game

- `game/` imports `engine + ai + render` only. Lab/analytics code moves out to `lab/`.
- Default view is play. The **ultra-fast AI-vs-AI** mode (existing `SPEEDS.ultra`) is retained — it reuses the headless turn loop with rendering throttled.
- Bundle-size ceiling enforced by the gate so the Game stays lean.
- This part largely **falls out of the module split** — most of the work is mechanical extraction, with the parity harness proving no behavior changed.

---

## 5. Part 2 — the AI Performance Overview (Lab)

All client-side. Three capabilities:

### 5.1 Dashboards (read-only for anon)

- **Faction fairness** — win-rate per house against target bands.
- **Per-unit performance** — build rate, win contribution, kill/death, cost-efficiency, "dead roster" flags.
- **Learning trends** — genome/archetype drift across games; convergence.
- **Game-by-game team performance** — standings over a batch; lead changes.
- **Pivotal-moment analytics** — the existing chronicle, expanded.
- **Benchmark comparison** — current run vs committed baseline, with deltas.

Seeded from today's analytics screen; expanded.

### 5.2 Dials (auth only)

- `BAL` global dials (existing Rules tab).
- `FACTION_CFG` per-house dials (existing Houses tab).
- **`UNIT_CFG` per-unit editor (NEW Units tab)** — attack / defence / move / cost / counters per unit type. Same live-mutable-config pattern as Houses.
- Reset-to-defaults per section and globally.

### 5.3 History & benchmarking

- **Session runs → IndexedDB** — compare runs in-session, export/import JSON.
- **Official baselines → committed `bench/baseline-*.json`** — `git log` is the long-term trend record.
- Authed John can "Save as baseline" → writes a candidate baseline JSON the human commits (or, in Phase 3, the gate/PR flow updates it).

### 5.4 Auth model

The Lab is a static page but is served same-origin under `strangeramblings.com/projects/brass-and-rails/`. It calls the SR site's session endpoint to determine auth:
- **Anon** → dashboards, current dial values, committed baselines visible; **all edit controls disabled**; may run a read-only sim with shipped config.
- **Authed (John)** → edit dials, run custom-config experiments, save baselines/exports.

No game data is written server-side; auth only gates client-side edit affordances + (Phase 3) baseline-save calls.

---

## 6. Part 3 — the Forge (jkai integration)

A console page **in the repo**, hard-scoped to this repo, that drives the **existing jkai-builder engine** plus the **sim harness as the gate**.

### 6.1 Triggers (all converge on one pipeline)

- **By John** — type a change request into the Forge.
- **Regularly** — a cron fires a standing directive (e.g. "review analytics, fix the highest-value balance/roster issue").
- **Autonomously** — the agent draws from a committed `ROADMAP.md` / `ideas.json`, or from sim findings.

### 6.2 Pipeline

```
trigger
  -> builder checks out a git WORKTREE + new BRANCH
  -> agent iterates (reusing builder loop: budget, plan/iter approval, logging, session-inject)
  -> runs `npm run gate`  (build + headless sims + baseline diff + design-lint)
       gate FAIL -> discard, never proposed
       gate PASS -> push branch + open PR (diff summary + sim report)
  -> HUMAN reviews & merges (D4: always human review)
  -> merge to main -> deploy
```

### 6.3 The gate (`npm run gate`)

Lives **in the repo**, versioned with the code, so the builder stays generic. Checks:

1. typecheck + `vite build` succeeds; bundle under ceiling.
2. headless sim of N games: **no crash**, all complete.
3. **fairness** — every house win-rate within its configured target band.
4. **roster liveness** — no unit type built 0 times across the batch.
5. **economy sanity** — end-banked resources within bounds (binding-constraint checks).
6. **performance** — avg sim time per game under budget (keeps quick-run fast).
7. **regression** — key metrics not worse than the committed baseline beyond tolerance; deltas reported in the PR.
8. **design-lint** — the guardrails in §6.4.

Exact thresholds (N, fairness band width, tolerances, bundle ceiling, perf budget) are config in `gate/` and tuned during Phase 3; sensible starting values derived from current balance work.

### 6.4 Guardrails / design principles

Encoded in `DESIGN.md` (human-readable) and machine-checked in `gate/`:

- **Theme lock** — Darlington / Teesdale / railway naming; off-theme content flagged.
- **Visual lock** — SR design tokens only (Archivo Black / DM Sans / JetBrains Mono / DM Mono, `sr.` monogram, tokenized warm-brutalist palette). **No new fonts** (forbid Space Grotesk, Neue Haas, etc.). No hardcoded hex outside the token set.
- **Static & sealed** — stays a client-side static game; no external network calls added; dependency allowlist (no new deps without human review).
- **Lean Part-1** — `game/` may not import `sim`/`lab`/`forge`; bundle ceiling enforced.
- **Gameplay invariants** — the fairness / roster / economy assertions (§6.3) *are* design principles.
- **Scope lock** — the Forge/scoped API can only target this repo; any other target is refused.

### 6.5 Reuse of builder infrastructure

The one genuinely new builder capability is a **git-target build mode**: checkout an existing repo → work on a branch → output a PR, instead of the current fresh-workspace → snapshot → publish-copy flow. It sits **behind a flag** so normal jkai builds are untouched.

The Forge page (client-side, in the repo) calls a small **repo-scoped API** — e.g. `/api/projects/brass-and-rails/forge/*` in the SR app, auth-gated and hard-scoped — which proxies to the existing builder sidecar via `builderClient`. This also closes a real gap the codebase has today (no git VCS, no way to extend an already-published project).

---

## 7. Build & deploy

- `npm run build` (Vite, multi-page) → `dist/{index,lab,forge}.html` + assets.
- **Public deploy** (`scripts/deploy.sh` in the game repo): build, copy **Game + Lab** into the SR site's `static/projects/brass-and-rails/`, rsync to VPS. **Forge excluded** from the public copy.
- **Forge** served on homeserv only, against the scoped API.
- Deploy verification per repo convention (HTTP 200 + byte/marker check) is retained.

---

## 8. Decomposition & sequencing

Three sub-projects, each its own spec → plan → implement cycle. Dependency order:

- **Phase 0 + 1 — Repo + module refactor + lean Game (SPEC THIS FIRST).**
  Scaffold `~/brass-and-rails/` with Vite + multi-page config; **centralize all randomness behind one seedable RNG in `shared/`** (prerequisite for deterministic parity testing); extract the single file into the `engine/ai/sim/shared/render/game/lab` module tree; **prove behavior parity** against the current game using the headless harness (which becomes `src/sim/` + the parity check); ship the lean Game and a baseline build of the Lab. Establishes the repo, the build, and the deploy path. *Everything depends on this.*

- **Phase 2 — the Lab.**
  `UNIT_CFG` per-unit editor; expanded dashboards (per-unit performance, learning trends, benchmark comparison); IndexedDB session history; git-baseline tooling; auth gating (read-only/editable).

- **Phase 3 — the Forge.**
  Git-target builder mode (flagged); repo-scoped auth-gated API; the Forge page; the three triggers (manual/cron/autonomous); `npm run gate` wired as the merge gate; `DESIGN.md` guardrails + machine checks; PR flow with sim report.

This document is the overarching architecture + decomposition. **Phase 0+1 is specified in implementable detail above; Phases 2 & 3 are sketched** and will each get their own spec when reached.

---

## 9. Non-goals (YAGNI)

- No backend/DB for Lab data (D3 — client-side + git baselines only).
- No auto-merge / auto-deploy of any kind (D4 — always human review).
- No generalization of the site-wide `/jkai/builds` UI (D5 — repo-scoped Forge only).
- No multiplayer, no networked play, no accounts beyond the existing Google OAuth used only to gate Lab edits.
- No rewrite of game *content* during the refactor — Phase 0+1 must be behavior-preserving; gameplay changes come later, through the Lab/Forge.

---

## 10. Risks & mitigations

- **Behavior drift during extraction** → the parity harness is the acceptance test for Phase 0+1. Extraction is mechanical (move code, no logic change), so with a **fixed RNG seed** a batch of games must reproduce pre-refactor results **exactly** — not "within tolerance" (a tolerance would mask real drift). Any unavoidable float-ordering difference must be isolated and documented, not waved through.
- **Build step complicates the previously drop-in deploy** → `scripts/deploy.sh` automates build→copy→rsync→verify; the jkai sandbox already runs builds.
- **Git-target builder mode destabilizing normal builds** → behind a flag; normal fresh-workspace flow untouched; scope-locked API.
- **Guardrail lint false-positives blocking good changes** → lint findings surface in the PR for human override; the human merge gate is the backstop (D4).
- **The Lab/Forge pulling weight into the public bundle** → module-import rules + bundle ceiling enforced by the gate; Forge excluded from public deploy.

---

## 11. Open items (defaults chosen; correctable)

- **Page names** — working titles: Game / Lab / Forge. The Lab could be themed "The Drawing Office" (Stephenson's loco design office); the Forge keeps its name. Final naming during Phase 2/3.
- **Gate thresholds** — starting values from current balance work; tuned in Phase 3.
- **Repo hosting** — local git is sufficient for D2/D4; a GitHub remote (e.g. under `zerosumpain`) is optional and can be added without design change.
