# Health design system implementation — 2026-08-30

Autonomous build (Full grade). Fable planned; Opus subagents implement.

## Brief

John uploaded a design handoff to Drive (`health_design_system/Strange Ramblings
health editorial.zip`). Five `.dc.html` design references for the owner-gated
`/health` area, to be implemented **faithfully** — high fidelity, colours/type/
spacing/copy final — including the backend tweaks the pages need. The handoff's
`README.md` is the authoritative spec for visuals and data binding; this file
records the build plan and decisions, not a restatement of it.

Handoff working copy (session scratchpad, canonical copy stays in Drive):
`/tmp/claude-1000/-home-john/4b0dffe8-6f42-447d-bd04-53ea8840b9bf/scratchpad/hds/design_handoff_health_hub/`

| Screen | Route | Action |
| --- | --- | --- |
| Health Dashboard | `/health` (owner view only) | Replace owner rendering, 9 sections A–I |
| Activities | `/health/activities` | Replace |
| Activity Detail | `/health/activities/[id]` | Replace |
| Segment Detail | `/health/segments/[id]` | Replace |
| Health Read | — | Reference only, NOT built |

## Hard constraints (from memory + repo rules — violating any is a bug)

1. **The anonymous `/health` payload and rendering do not change.** `PUBLIC_FIELDS`
   picking, `disclosureLeaks()`, featured activities, the exact-path public gate,
   `Cache-Control: private, no-store` + `Vary: Cookie` on owner responses — all
   untouched. The redesign applies to what renders when `data.mode === 'owner'`.
2. `EFFECTIVE_TYPE` / `effectiveType()` semantics; `rankEfforts` + ranked
   denominators; `MIN_HR_COVERAGE = 0.5`; EF only for pace sports; totals from
   the filter; ties share a rank; trailing split never rounded up; sufficiency
   flags surfaced. (The designs depend on these — the handoff lists them.)
3. `classifyLoadBalance` scoring stays as shipped (fresh scores 85–90). The ACWR
   overreached lock still beats readiness in the planner.
4. Never `select()` `activities.metadata`, `activity_tracks.coordinates` or
   `activity_series.samples` wholesale in list queries; single-row reads for the
   detail pages project what they need. `withPolyline` stays opt-in.
5. All derived copy (ledes, verdict, rationale lines) is **computed, never
   model-written**. No LLM calls anywhere in this build.
6. The coach/planner call keeps its 6s abort budget and daily memoisation.
7. Do not weaken or delete unrelated tests to go green. Update a test only when
   the contract it asserts is one this design deliberately changes, and say so
   in the commit message.
8. `HealthDay` carry-forward: count real workouts, never `strain > 0` days.

## Decisions

| # | Decision | Options | Why | Reversible |
| --- | --- | --- | --- | --- |
| 1 | New derived layers are pure modules + thin service wrappers, no LLM, no schema change | derive vs persist vs LLM-phrase | Precedent: `ledes.ts`, `coach.ts`, `highlights.ts`. Values fall out of existing analytics | Yes |
| 2 | Experiments (section H) are fully derived: eligible experiments ranked, top one whose entry condition currently holds = LIVE, others QUEUED; day counter = days since the triggering condition's onset in the series | derive vs new table + owner CRUD | No schema change, no new admin surface; the handoff gates them on B/E thresholds anyway | Yes — a table can replace the derivation later |
| 3 | Segment gradient-band strip is implemented for real (elevation is in the stored segment coordinates); the PROPOSED badge is dropped like the illustrative-figure footers | keep badge vs implement | The badge was a designer-to-engineer note; the note itself says it is derivable without schema change | Yes |
| 4 | The activities-table "proposed refinement" card (EF-by-sport) ships as designed — it is page copy, clearly marked as a proposal; EF sorting behaviour is NOT changed | implement refinement vs ship copy | Fidelity: the design ships the card, not the refinement | Yes |
| 5 | Shared chrome is a `HealthShell` component (sticky header z-80, pulsing live dot, grain overlay z-70) used by the four owner views — **not** a `+layout.svelte` | layout vs component | A layout would re-skin the anonymous `/health` landing, which is out of scope | Yes |
| 6 | New tokens in `app.css`: accent-on-dark `#e8863a`, olive good `#6b7f4a` (fill on dark) / `#55663a` (text on paper), per the handoff's token table | — | Handoff instructs adding them | Yes |
| 7 | Old owner-view components that end up entirely unreferenced are deleted with their tests (dead-code discipline); anything the anonymous branch renders stays | keep vs delete | Repo rule: nothing unreferenced survives | Yes (git) |
| 8 | Sequential Opus implementation agents in one worktree (`~/wt-health`, branch `health-design-system`), not parallel | parallel vs sequential | John's constraint is credit, not wall-clock; sequential avoids concurrent svelte-check OOM on homeserv and lets later pages reuse earlier primitives | — |
| 9 | Owner-view visual verification happens on homeserv (LAN owner bypass) against a prod build of the branch; production verification after deploy = public `/health` unchanged + deploy sha + owner routes still gated | — | Prod owner session cannot be scripted (Google auth) | — |
| 10 | New page-level CSS uses its own class grammar scoped to the new pages; the old `.h-statrow`/`.h-chartgrid`/`.h-note` grammar stays for the anonymous landing only and is removed when the last owner reference goes | reuse h-* vs new | The new design's grammar (radius 0 / pills 100px, borders-not-shadows, dark decks) is different by intent | Yes |

## Task breakdown (sequential; each commits to `health-design-system`)

**Task 1 — Foundations (backend + tokens + shell).**
- `app.css`: the three new tokens (decision 6).
- `src/lib/components/health/hub/HealthShell.svelte`: sticky header + live dot +
  grain overlay + the shared section primitives the handoff defines (dark deck
  band, paper band, radii/border rules).
- New pure modules, TDD (tests first, `npx vitest run <file>`):
  - `src/lib/health/analytics/forecast.ts` — projection + uncertainty cone +
    confidence from `TrendSeries` (`rolling7`, `latest7`, `baseline28`).
  - `src/lib/health/moves.ts` — ranked moves (≤5) composed from the instrument
    outputs; each move: title, rationale, buys, costs, leverage 1–5.
  - `src/lib/health/tripwires.ts` — 9 tripwires; thresholds from the repo
    constants (recovery-debt 240min / balance 8, ACWR bands, form gap 3%, …);
    states TRIPPED / CLOSE / ARMED.
  - `src/lib/health/experiments.ts` — decision 2.
  - `src/lib/health/verdict.ts` — headline + review rows, derived like `ledes.ts`.
  - `src/lib/trails/segments/gradient-bands.ts` — decision 3.
- Loader wiring: extend `/health/+page.server.ts` **owner** payload with the
  instrument deck (services in `src/lib/health/services/` already exist),
  forecast, moves, tripwires, experiments, verdict; extend
  `/health/activities/+page.server.ts` with the per-row lead excellence
  highlight (`getHighlightCorpus`); verify the two detail loaders expose
  everything their screens bind (TRIMP, HRR curve + hrr60, zones, decoupling,
  METs, same-sport comparisons, pb progression, conditions, similar segments,
  gradient bands).

**Task 2 — Health Dashboard** (`Health Dashboard.dc.html`, sections A–I) —
replace the owner rendering of `src/routes/health/+page.svelte`; new components
under `src/lib/components/health/hub/`; anonymous branch byte-identical.

**Task 3 — Activities list** (`Activities.dc.html`) — header, totals tiles,
training strip (reuse `Bars`), type chips, 12-column table, excellence badges,
"reading the table" cards.

**Task 4 — Activity Detail** (`Activity Detail.dc.html`) — stat cells,
highlights, `TrackMap` route card, traces, zones, effort & recovery, splits,
segments-on-this-one, provenance.

**Task 5 — Segment Detail** (`Segment Detail.dc.html`) — identity, ground (map +
elevation profile + gradient bands), form + effort scatter, record & conditions,
comparable ground, "what would take it".

**Task 6 — Review + fixes** — code review over the branch diff; apply findings.

**Task 7 — Ship** — `./scripts/gate-remote.sh` from the worktree; PR; merge to
master (CI deploys — never `deploy.sh`); verify live per decision 9; retire the
newly-unreferenced components (decision 7) if not already done; memory update;
final report.

## Verification commands (named before code, per solution-design)

- Unit: `npx vitest run src/lib/health/{moves,tripwires,experiments,verdict}.test.ts src/lib/health/analytics/forecast.test.ts src/lib/trails/segments/gradient-bands.test.ts`
- Anon regression: render `/health` anonymously from a local prod build before
  and after; diff the HTML (allowing only hashed asset names to differ).
- Visual: local prod build on homeserv, screenshot each of the four owner pages
  beside its `.dc.html` opened in the same browser.
- Gate: `./scripts/gate-remote.sh` (porkserv lane, TZ=UTC pinned there).
- Live: public `/health` unchanged; `/health/activities` still owner-gated;
  `build/.deploy-sha` on the VPS matches the merge commit.
