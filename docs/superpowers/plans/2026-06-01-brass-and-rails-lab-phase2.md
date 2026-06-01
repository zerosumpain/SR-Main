# Brass & Rails — Phase 2: The AI Performance Lab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Lab (`lab.html`) into a full AI-performance overview: a per-unit *full designer* (`UNIT_CFG`) for live tuning, per-unit performance dashboards, benchmark-vs-baseline comparison, IndexedDB run history, a learning-trends (warm-memory self-play) mode, and read-only/owner-editable auth gating.

**Architecture:** Continue in `~/brass-and-rails/` (Phase 0+1 complete; `npm run sim:parity` green 72/72). Add a `UNIT_CFG` overlay in `src/shared/data.js` mirroring `FACTION_CFG`; route the (already-dynamic) unit-stat reads through one `udef(type)` accessor so empty overrides preserve parity. Add per-unit telemetry to the engine and surface it through `simOneGame`/`summariseBatch`. Extend the Lab UI (`src/lab/`) with a Units tab, dashboards, baseline compare, IndexedDB history, and a marathon mode. Add one new endpoint `/api/auth/me` to the SvelteKit app for the auth gate.

**Tech Stack:** the existing ESM/Vite repo; IndexedDB via a tiny hand-rolled promise wrapper (no new dep); Playwright for smokes; one new SvelteKit `+server.ts` route in `~/strange_rambling_svelte`.

**Hard invariant:** engine changes are behaviour-preserving. After Tasks 1 and 3, `npm run sim:parity` MUST still print `PARITY OK` (72/72). With `UNIT_CFG`/`CTR_CFG` empty, `udef()` must return UNIT_TYPES semantics exactly; telemetry may only ADD recording, never change game logic. The committed parity digest (turn/winner/winKind/per-player cities/units/techs/score/res) does not read the new telemetry fields, so additive recording keeps it green.

---

## Background the executor needs (from a code audit of the repo)

- **`UNIT_TYPES`** (`src/shared/data.js`): per-unit `{ name, cost, wood?, stone?, food?, hp, atk, def, move, range, tech, domain, role, glyph, desc, needs?, port?, cargo? }`. Example: `guard: { name:'Quaker Guard', cost:3, wood:2, hp:10, atk:2, def:2, move:1, range:1, tech:null, domain:'land', role:'mil', glyph:'♟', desc:'…' }`. **No `tier` field yet** — add one to `UNIT_CFG` (optional override; default = derived from `tech` prereq depth or null).
- **`COUNTERS`** (`src/shared/data.js`): `{ <unit>: { beats: string[], label: string } }`. The counter bonus magnitude is `BAL.counterBonus` (0.50). The full designer edits per-unit `beats` lists (and optionally a per-unit counter weight).
- **`FACTION_CFG`** is the pattern to mirror: a mutable object keyed by id, read dynamically at call sites (e.g. `FACTION_CFG[p.faction.id].atkMult` in `src/engine/units.js`), with a frozen `FACTION_CFG_DEFAULTS` for reset. The Lab's Houses tab edits it live.
- **Unit-stat reads are already dynamic** (good — overlay takes effect live). Read sites to route through `udef(type)`:
  - `src/engine/units.js`: `unitMove` (`UNIT_TYPES[u.type].move` ~line 25), `defenseBonus` (~97), `attackFactors` (~117), `counterMult`/`predictCombat`/`resolveCombat` (atk/def/hp/range), `canEnter` (domain), `attackTargets` (range), `transportCap` (cargo).
  - `src/engine/economy.js`: `unitCost` (`d=UNIT_TYPES[tid]; prod=d.cost; wood:d.wood…` ~line 153).
  - `src/engine/map.js`: `spawnUnit` (`hp`→`u.maxHp`, baked at spawn — fine, fresh per game; read `udef(type).hp`).
  - `src/ai/decide.js`: `aiChooseBuild` (build scoring — where the build-attraction weight applies), gating via `needs`/`tech`.
  - Search for every `UNIT_TYPES[` read across `src/engine` and `src/ai` and route the per-unit-stat ones through `udef`.
- **`simOneGame(seed,count,mapSize)`** returns `{ seed, turns, gameOver, winner, kind, maxCityLevel, leadChanges, earlyLeaderWon }`. **`summariseBatch`** returns `{ recs, exceptions, requested, completed, kinds, facWins, avgTurns, avgMaxLevel, avgLeadChanges, earlyLeaderWinPct }`.
- **Existing per-unit telemetry:** `p.stats.built[type]` (build counts, set in `src/engine/map.js` `spawnUnit`). Player-level `p.stats.kills`/`lossesU` exist but are NOT per-unit-type. AI memory's `unitStats[type]={built,winBuilt,lossBuilt}` is only populated by `recordGameResult`, which the **headless sim never calls** (endGame early-returns; memory stays clean). So the batch sim currently surfaces **no per-unit data** — Task 3 adds it directly to the sim return.
- **Lab UI patterns** (`src/lab/`): `LAB_DIALS` descriptors `{ k, path:[...], label, help, min, max, step }`; `dialGet/dialSet/dialDefault` navigate `path` into `BAL`. `HOUSE_KNOBS` per-faction `{ k, label, min, max, step, help }`. `buildLabDials`/`buildLabHouses` render inputs+sliders, on change mutate the live config then re-render. `labRun` → `simulateBatch` → `renderLabResults`. `renderRoster` already shows a per-unit table reading `knowledge.unitStats` (build/win% from real-play memory) — Phase 2's dashboard supersedes it with sim-derived data. `renderAnalysis`/`renderDossier` read `state.knowledge` (genome/lessons/history). **No IndexedDB yet.**
- **Auth (SvelteKit `~/strange_rambling_svelte`):** owner gate is the `AUTH_ALLOWED_EMAILS` allowlist checked in `src/hooks.server.ts` (`signIn` callback). `locals.auth()` returns the Auth.js session `{ user:{ email, name, image }, expires }`. Existing `/api/auth/session-check` returns 204/401 with no body. Phase 2 adds `/api/auth/me` returning a JSON body. Same-origin cookies flow automatically from `lab.html`.

---

## Task 1: `UNIT_CFG` overlay + `udef()` accessor + dynamic-read wiring (parity-gated)

**Files:** Modify `src/shared/data.js`; add `udef`/`ctrOf` accessors; modify `src/engine/units.js`, `src/engine/economy.js`, `src/engine/map.js`, `src/ai/decide.js`.

- [ ] **Step 1:** In `src/shared/data.js` add:
```js
export const UNIT_CFG = {};                 // per-type partial overrides, e.g. { guard:{ atk:3 } }
export const UNIT_CFG_DEFAULTS = {};         // empty = pristine (overlay no-op)
export const CTR_CFG = {};                   // per-type counter overrides, e.g. { pike:{ beats:['pony'] } }
export const CTR_CFG_DEFAULTS = {};
// Effective unit definition: base UNIT_TYPES merged with live UNIT_CFG overrides.
export function udef(type){ const b = UNIT_TYPES[type]; const o = UNIT_CFG[type]; return o ? { ...b, ...o } : b; }
// Effective counter entry.
export function ctrOf(type){ const b = COUNTERS[type]; const o = CTR_CFG[type]; return o ? { ...b, ...o } : b; }
```
- [ ] **Step 2:** Route every per-unit-stat read in `src/engine/units.js`, `src/engine/economy.js`, `src/engine/map.js` from `UNIT_TYPES[x]` to `udef(x)` (atk/def/hp/move/range/cost/wood/stone/food/domain/cargo/needs). Route `COUNTERS[x]` reads (in `counterMult`) to `ctrOf(x)`. Import `udef`/`ctrOf` from `../shared/data.js`. **Do not** change any formula — only the source of the stat value.
- [ ] **Step 3:** In `src/ai/decide.js` `aiChooseBuild`, multiply the per-unit build score by `(UNIT_CFG[type]?.aiWeight ?? 1)` (the build-attraction weight — default 1 = no change). Route any `UNIT_TYPES[`/`COUNTERS[` reads there through `udef`/`ctrOf`.
- [ ] **Step 4: Parity gate (the test).** With `UNIT_CFG`/`CTR_CFG` empty, behaviour must be identical.

Run: `cd ~/brass-and-rails && npm run sim:parity`
Expected: `parity: 72/72 games match`, `PARITY OK`. If it drifts, a read was changed incorrectly (e.g. `udef` not falling back to base, or a non-stat read mistakenly routed) — fix the wiring, do not touch the baseline.

- [ ] **Step 5: Overlay-takes-effect smoke** (proves live tuning works). Create `~/brass-and-rails/test/unitcfg-effect.mjs`:
```js
import { state } from '../src/core/state.js';
import { UNIT_CFG } from '../src/shared/data.js';
import { simulateBatch, summariseBatch } from '../src/sim/run.js';
const base = await simulateBatch(20, { count:6, mapSize:'medium', seed0:1000 });
UNIT_CFG.guard = { atk: 8, def: 8, hp: 30, cost: 1 };   // make Guards absurdly strong & cheap
const buffed = await simulateBatch(20, { count:6, mapSize:'medium', seed0:1000 });
delete UNIT_CFG.guard;
console.log('base avgTurns', base.avgTurns, '-> buffed avgTurns', buffed.avgTurns,
  '| facWins changed:', JSON.stringify(base.facWins) !== JSON.stringify(buffed.facWins));
```
Run: `node test/unitcfg-effect.mjs` → the two summaries must DIFFER (overlay had an effect). Then re-run `npm run sim:parity` (must still be green — the `delete` restored defaults).
- [ ] **Step 6:** Commit: `unit-cfg: live per-unit overlay (UNIT_CFG/CTR_CFG) via udef(); parity 72/72 preserved`.

---

## Task 2: Units tab (the full unit designer) in the Lab

**Files:** Modify `src/lab/lab.js` (add `UNIT_KNOBS`, `buildLabUnits`, `labResetUnits`, extend `labShowTab`), `lab.html` (add a Units tab button + pane).

- [ ] **Step 1:** In `src/lab/lab.js` define the per-unit editable fields (full designer per the chosen scope):
```js
const UNIT_STAT_KNOBS = [
  { k:'atk',   label:'Attack',  min:0, max:12, step:0.5 },
  { k:'def',   label:'Defence', min:0, max:12, step:0.5 },
  { k:'hp',    label:'HP',      min:1, max:60, step:1 },
  { k:'move',  label:'Move',    min:1, max:6,  step:1 },
  { k:'range', label:'Range',   min:1, max:5,  step:1 },
  { k:'cost',  label:'Prod cost', min:1, max:20, step:1 },
  { k:'wood',  label:'Wood cost', min:0, max:20, step:1 },
  { k:'stone', label:'Stone cost', min:0, max:20, step:1 },
  { k:'aiWeight', label:'AI build pref', min:0.1, max:4, step:0.1 },
  { k:'tier',  label:'Tech tier', min:0, max:4, step:1 },
];
```
- [ ] **Step 2:** `buildLabUnits()` — render one card per `UNIT_TYPES` key (mirror `buildLabHouses` markup/classes `.house-card`/`.hc-*`). Each card: the stat knobs above (number + range, reading `udef(type)[k]` for current value, writing to `UNIT_CFG[type][k]`), a **counters editor** (checkboxes/chips for which other units this unit `beats`, writing `CTR_CFG[type].beats`), a **needs editor** (toggle the strategic resources in `needs:[...]`), and a per-unit **reset**. On any change: set the override, then re-render (and if `state.G?.started`, recompute live — mirror the Houses tab's `recompute`). Setting a knob back to the base value should `delete UNIT_CFG[type][k]` (keep overrides minimal) — but simpler: always write the override; `labResetUnits` clears `UNIT_CFG`/`CTR_CFG` to `{}`.
- [ ] **Step 3:** `labResetUnits()` — `for (const k in UNIT_CFG) delete UNIT_CFG[k]; for (const k in CTR_CFG) delete CTR_CFG[k];` then re-render. Add a "Reset all units" button.
- [ ] **Step 4:** Extend `labShowTab` to handle a third tab `'units'`; add `#labTabUnits` button + `#labPaneUnits` pane to `lab.html` (mirror the Rules/Houses tab markup). `src/lab/main.js`: call `buildLabUnits()` on load.
- [ ] **Step 5: Smoke.** Extend `test/smoke-lab.mjs` (or add `test/smoke-units.mjs`): load `/lab.html`, click `#labTabUnits`, assert `#labPaneUnits` shows ≥1 unit card with knob inputs, change a Guard atk input, run a 5-game batch, confirm results populate + `errors:[]`, screenshot `/tmp/brass-lab-units.png`.

Run (dev server via background-task mechanism on port 5273, then): `BASE=http://localhost:5273 node test/smoke-units.mjs`
Expected: `{ unitCards: >0, ranBatch:true, errors:[] }`.
- [ ] **Step 6: Controller inspects `/tmp/brass-lab-units.png`** — unit cards with editable stats/counters/needs render in the design system. Commit: `lab: Units tab — full per-unit designer (stats/counters/needs/tier/AI-pref)`.

---

## Task 3: Per-unit telemetry in engine + sim (parity-gated)

**Files:** Modify `src/engine/map.js` (stats init), `src/engine/units.js` (`resolveCombat`/`killUnit`), `src/sim/run.js` (`simOneGame` return + `summariseBatch`).

- [ ] **Step 1:** In `src/engine/map.js` where `p.stats` is initialised, add `unitKills:{}`, `unitDeaths:{}` (per unit type). (`built:{}` already exists.)
- [ ] **Step 2:** In `src/engine/units.js`: when an attacker kills a defender (the existing `ap.stats.kills++` site), also `ap.stats.unitKills[att.type]=(ap.stats.unitKills[att.type]||0)+1`. When a unit dies (`killUnit`, and the attacker-loss site `ap.stats.lossesU++`), record `owner.stats.unitDeaths[dead.type]=(…||0)+1` for the unit's owner. Only ADD recording — touch no combat math.
- [ ] **Step 3:** In `src/sim/run.js`, extend `simOneGame` to return per-unit aggregates for the finished game alongside the existing fields:
```js
const perUnit = {};
for (const p of state.G.players) {
  for (const t in (p.stats.built||{}))      (perUnit[t] ??= {built:0,kills:0,deaths:0,byWinner:0}).built  += p.stats.built[t];
  for (const t in (p.stats.unitKills||{}))  (perUnit[t] ??= {built:0,kills:0,deaths:0,byWinner:0}).kills  += p.stats.unitKills[t];
  for (const t in (p.stats.unitDeaths||{})) (perUnit[t] ??= {built:0,kills:0,deaths:0,byWinner:0}).deaths += p.stats.unitDeaths[t];
  if (state.G.winner && p.id === state.G.winner.id)
    for (const t in (p.stats.built||{}))    (perUnit[t] ??= {built:0,kills:0,deaths:0,byWinner:0}).byWinner += p.stats.built[t];
}
// ...return { ...existing, perUnit };
```
- [ ] **Step 4:** In `summariseBatch`, aggregate `perUnit` across `recs` into `unitAgg[type] = { built, builtPerGame, kills, deaths, kd, byWinner, winShare, costEff }` where `winShare = byWinner/built` (build-by-winner rate), `kd = kills/max(1,deaths)`, `costEff = winShare / udef(type).cost` (import `udef`). Add `unitAgg` to the returned object.
- [ ] **Step 5: Parity gate.** Run `cd ~/brass-and-rails && npm run sim:parity` → still `PARITY OK` (72/72). (The digest doesn't include `perUnit`/`unitAgg`, and recording is additive, so it must stay green. If it drifts, a combat-math line was touched — revert that.)
- [ ] **Step 6: Telemetry smoke.** `node -e "import('./src/sim/run.js').then(async m=>{const b=await m.simulateBatch(10,{count:6,mapSize:'medium',seed0:1000}); console.log(Object.keys(b.unitAgg||{}).length,'unit types; sample:', JSON.stringify(b.unitAgg?.guard))})"` → prints a positive count + a guard entry with built/kills/deaths/winShare.
- [ ] **Step 7:** Commit: `telemetry: per-unit kills/deaths + sim unitAgg (built/K:D/winShare/costEff); parity preserved`.

---

## Task 4: Per-unit performance dashboard in the Lab

**Files:** Modify `src/lab/lab.js` (`renderLabResults` — add a per-unit section) and/or `src/lab/ui.js`.

- [ ] **Step 1:** In `renderLabResults`, after the existing aggregates, render a **per-unit performance table** from `LAB_CUR.unitAgg`: columns Unit · Built/game · Win-share% · K:D · Cost-eff · over/under-built flag (flag `builtPerGame` far above/below the roster mean). Sort by win-share or built. Reuse the `labBarRow`/bar styling. Colour over/under-built like the existing analysis.
- [ ] **Step 2:** Add a small "dead roster" callout: any unit type with `built===0` across the batch (the metric Phase-1 era cared about). 
- [ ] **Step 3: Smoke + screenshot.** Re-run the lab smoke (Task 2's), confirm the per-unit table appears after a batch; screenshot `/tmp/brass-lab-perunit.png`; controller inspects it (rows render with bars + flags).
- [ ] **Step 4:** Commit: `lab: per-unit performance dashboard (build rate / win-share / K:D / cost-eff / dead-roster)`.

---

## Task 5: Benchmark vs committed baseline

**Files:** Add `bench/baseline-v1.json`; modify `src/lab/lab.js` (compare + save/export).

- [ ] **Step 1:** Generate and commit a baseline: run a fixed batch (e.g. `simulateBatch(50,{count:6,mapSize:'medium',seed0:1000})` with default config) and write its `summariseBatch` output to `bench/baseline-v1.json` (a script `node -e` is fine). Commit it (git = trend history, per the spec).
- [ ] **Step 2:** In the Lab, add a "Benchmark" control: load `bench/baseline-v1.json` (fetch relative URL — it ships as a static asset; add it under the page's served path or import it), and render a **delta table** comparing the current run's key metrics + per-faction win rates + per-unit win-share to the baseline (reuse the existing before/after delta widget the Houses results already use). Highlight regressions (e.g. fairness drifting, a unit going dead).
- [ ] **Step 3:** Add "Save as baseline" (owner-only — wired in Task 8): downloads the current `summariseBatch` as `baseline-vN.json` for the user to commit. (Client-side `Blob` download; no backend.)
- [ ] **Step 4: Smoke:** load lab, run a batch, click Benchmark, confirm the delta table renders vs baseline, `errors:[]`, screenshot `/tmp/brass-lab-bench.png`; controller inspects. Commit: `lab: benchmark current run vs committed baseline + save-as-baseline export`.

---

## Task 6: IndexedDB session history

**Files:** Add `src/lab/history.js` (tiny IndexedDB wrapper); modify `src/lab/lab.js` (save each run, list, compare, export).

- [ ] **Step 1:** `src/lab/history.js` — a minimal promise wrapper over IndexedDB (no dep): open db `brass-lab` v1, object store `runs` (keyPath `id`, autoIncrement), with `saveRun(record)`, `listRuns()`, `getRun(id)`, `deleteRun(id)`, `clearRuns()`. Each `record = { id, ts:<passed-in>, label, config:{n,count,mapSize}, dials:<snapshot of changed BAL/FACTION_CFG/UNIT_CFG>, summary:<summariseBatch output> }`. (Pass timestamps in from the caller — `Date.now()` is fine in the browser here.)
- [ ] **Step 2:** In `labRun`, after a batch completes, `saveRun(...)` it. Add a "History" pane/section listing past runs (label, time, key metrics) with: open (load its summary into the results view), compare-to-current (delta table), export JSON, delete, clear-all.
- [ ] **Step 3: Smoke:** load lab, run two batches, confirm History lists ≥2 runs and compare renders; screenshot `/tmp/brass-lab-history.png`; `errors:[]`. (IndexedDB works in the Playwright chromium context.) Commit: `lab: IndexedDB run history (save/list/compare/export/delete)`.

---

## Task 7: Learning-trends — warm-memory self-play marathon

**Files:** Add `src/sim/marathon.js` (`simMarathon`); modify `src/lab/lab.js`/`ui.js` (a Marathon mode + trend charts).

- [ ] **Step 1:** `src/sim/marathon.js` — `simMarathon(n, opts)` runs `n` games **carrying AI memory across them**: start from a fresh in-memory `knowledge` (do NOT touch the user's saved localStorage memory — snapshot `state.knowledge`, use a temp, restore after), and BETWEEN games call the real `recordGameResult(winner, kind)` (from `src/ai/decide.js`) so genomes drift and lessons accrue. After each game capture a trend point: `{ game:i, winnerFac, genomes:{fid:{...traits}}, lessonWeights:{...}, facWinCum:{...} }`. Return `{ trend:[...], final: summariseBatch-of-the-run }`. **Important:** marathon mode is NOT parity-relevant (it deliberately invokes learning); keep it isolated from `simOneGame`'s clean path so `npm run sim:parity` stays green (verify after).
- [ ] **Step 2:** In the Lab, add a "Marathon" run button (separate from the independent-batch run). On completion render: a **rolling win-rate-by-house line/area chart** over the game index, **genome-trait drift** per house (small multiples or the existing genome-bar style sampled at intervals), and **lesson-weight evolution**. Reuse `renderScoreChart`-style SVG or simple bars.
- [ ] **Step 3:** Verify `npm run sim:parity` still green (marathon must not have altered the clean path). Smoke: load lab, run a 15-game marathon, confirm trend charts render + `errors:[]`; screenshot `/tmp/brass-lab-marathon.png`; controller inspects. Commit: `lab: learning-trends marathon (warm-memory self-play) + genome/winrate/lesson trend charts`.

---

## Task 8: Auth gating — owner-editable, public read-only

**Files:** Add `~/strange_rambling_svelte/src/routes/api/auth/me/+server.ts`; modify `src/lab/main.js` + `src/lab/lab.js`/`ui.js` (gate edit controls).

- [ ] **Step 1:** In the SvelteKit app, create `src/routes/api/auth/me/+server.ts`:
```ts
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

function allowed(): string[] {
  return (env.AUTH_ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}
export const GET: RequestHandler = async ({ locals }) => {
  const session = await locals.auth();
  const email = (session?.user?.email || '').toLowerCase();
  const isOwner = !!email && allowed().includes(email);
  return json({ authenticated: !!session?.user, isOwner, email: isOwner ? email : null });
};
```
(Mirror the `getAllowedEmails` logic already in `src/hooks.server.ts`. This is additive — no other SvelteKit change.)
- [ ] **Step 2:** In the Lab (`src/lab/main.js`), on load `fetch('/api/auth/me')` (relative — same origin in prod; in local dev against the static page it 404s → treat as not-owner). Set a module flag `LAB_EDITABLE = data.isOwner`. When NOT editable: disable all dial/house/unit inputs (`disabled` + a "read-only — sign in to edit" banner), hide "Save as baseline" and "Reset" buttons, but KEEP "Run batch"/"Marathon"/dashboards/History/Benchmark fully usable (running sims is harmless and is the whole point of the public view). When editable: everything on.
- [ ] **Step 3: Smoke (both states).** The static `/api/auth/me` won't exist on the dev static server, so simulate: add a `?lab_owner=1` dev override read in `main.js` ONLY when `location.hostname` is localhost/homeserv, to force-enable for the smoke. Smoke loads `/lab.html` (read-only path → inputs disabled, banner shown) and `/lab.html?lab_owner=1` (editable → inputs enabled); assert the disabled/enabled state of a known input; screenshot both; `errors:[]`.
- [ ] **Step 4:** Commit (game repo): `lab: auth gate — owner-editable, public read-only (via /api/auth/me)`. Commit (SvelteKit repo, ONLY the new route file, NOT the unrelated WIP): `auth: add /api/auth/me endpoint (authenticated + isOwner) for the Lab gate`.

---

## Task 9: Build, verify, ship-readiness

- [ ] **Step 1:** `cd ~/brass-and-rails && npm run build` → clean. Lean check: the Game (`index`) bundle still has no `simulateBatch`/`buildLabUnits`/`simMarathon` (grep `dist/assets/*index*.js`). Lab bundle still has no THREE.
- [ ] **Step 2:** Re-run BOTH smokes against the built output (`vite preview` via the background-task mechanism, port 4399), all green, `errors:[]`.
- [ ] **Step 3:** Copy `dist/*` → `~/strange_rambling_svelte/static/projects/brass-and-rails/`; commit ONLY that path (NOT the unrelated hermes WIP). Do NOT run the VPS deploy (prod is in a broken-deploy state per the Phase-0+1 report; the live push is owner-gated). Report build readiness + screenshots.
- [ ] **Step 4:** `npm run sim:parity` one last time → `PARITY OK`. Tag `phase2-lab` in the game repo.

---

## Self-review (run after writing; fix inline)

- **Spec coverage (design §5):** UNIT_CFG full designer (Tasks 1-2, "Everything" scope chosen by owner — incl. counters/needs/tier/AI-pref); per-unit performance dashboards (Tasks 3-4); learning trends (Task 7); benchmarking vs committed baseline (Task 5); IndexedDB session history (Task 6); auth read-only/editable (Task 8); BAL + FACTION_CFG dials already shipped Phase-0+1. Game-by-game team performance = the existing batch facWins + History compare.
- **Parity safety:** Tasks 1 and 3 each end with a `npm run sim:parity` gate; Task 1 also has an overlay-takes-effect smoke (proves the lever works) and Task 9 re-checks. Empty `UNIT_CFG`/`CTR_CFG` ⇒ `udef`/`ctrOf` return base ⇒ identical behaviour.
- **Placeholder scan:** none. UI tasks reference the concrete existing patterns (`buildLabHouses`/`labBarRow`/`HOUSE_KNOBS`) + give the new descriptor shapes.
- **Consistency:** `udef`/`ctrOf` defined once (Task 1) and used in engine (Task 1) + sim `costEff` (Task 3) + UI current-values (Task 2). `UNIT_CFG` keys (`atk/def/hp/move/range/cost/wood/stone/aiWeight/tier`) consistent across Task 1 (wiring), Task 2 (knobs), Task 3 (costEff reads `udef`). `/api/auth/me` shape (`{authenticated,isOwner,email}`) consistent Task 8 server + client.
- **Cross-repo note:** Task 8 touches `~/strange_rambling_svelte` (one new route). Commit only that file there; the hermes WIP must stay untouched/uncommitted.
- **Deploy:** held (prod broken-deploy state); Task 9 prepares + commits the static build, owner runs the live deploy.
