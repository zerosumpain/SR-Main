# Brass & Rails — Headless Core Extraction & Parity Gate (Plan 1 of Phase 0+1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the pure game logic from the single-file `~/brass-and-rails.html` into an ES-module tree in a new git repo, and prove via a Node parity harness that it reproduces the current game's behaviour **exactly** for fixed RNG seeds.

**Architecture:** New git repo `~/brass-and-rails/`, Vite-ready, ESM. All mutable game state lives in one imported `state` object (`src/core/state.js`); the existing `mulberry32` PRNG moves into `src/core/rng.js` unchanged. Render/DOM calls that today sit inside otherwise-pure functions are replaced by calls to an injectable no-op `hooks` object (`src/core/hooks.js`) — the seam the browser layer (Plan 2) plugs into. Pure logic is carved into `shared/` (data tables), `engine/` (map-gen, economy, combat, territory, turn-loop), `ai/` (decisions + learning), `sim/` (headless batch runner). The parity gate is a Node script that imports the real modules and diffs a fresh seeded run against a golden baseline captured from the current file.

**Tech Stack:** Node 22 (ESM), Vite 5 (config added here, pages wired in Plan 2), no test framework needed for parity (a plain assert script), `git`.

**Hard invariant for this whole plan:** extraction is **behaviour-preserving**. Do **not** reorder RNG draws, change formulas, "improve" anything, or alter the per-game RNG stream. The only allowed changes are: (a) `bareGlobal` → `state.bareGlobal`, (b) render/DOM call → `hooks.X()`, (c) adding `import`/`export`. Any behavioural change is a bug the parity gate must catch.

---

## Background the executor needs

- **Source file:** `/home/john/brass-and-rails.html` (4246 lines). The JS is one `<script type="module">`, lines **592–4244**. The HTML/CSS shell (1–591) is **not** touched in this plan (it's Plan 2).
- **State access pattern:** the entire script is one closure. Every function reads/writes module-globals directly. The authoritative mutable-state set (from the existing `snapshotLive`, line 3900) is exactly: **`G, N, RNG, knowledge, autoplay`** (+ `_headless`, `speed`, `autoTimer`, `FR`, `_autoEndTimer`). We consolidate all of these into one `state` object.
- **The `_headless` path already works** and is the pure-logic path we keep:
  - `setupGame` (1083): the block at 1149-1155 (`if(!G._headless && renderer){ buildStaticScene(); reframeCamera(); rebuildDynamic(); refreshAll(); homeCamera(); }`) is render — becomes `hooks.afterSetup()`.
  - `advance` (3260): `if(G._headless){ if(p.isAI){ aiTurn(p); checkWin(); } return; }` (3268-3272) is the pure path; the rest is render/scheduler — becomes `hooks.afterAdvance()`.
  - `endGame` (3494): `if(G._headless) return;` (3497) after stashing `G.gameOver/winner/_winKind` (3495) — keep this early-return; the DOM/marathon/`recordGameResult` tail becomes `hooks.onEndGame()`.
  - `logMsg` (3331): `if(G._headless) return;` (3332) — becomes `hooks.log(tag,msg)` (default no-op).
  - `aiBuildImprovements` (2632): `if(typeof refreshTile==='function' && G.mode!=='auto') refreshTile(...)` — becomes `hooks.refreshTile(...)`.
- **Render boundary is clean:** THREE is confined to lines 1634-2201 and is **not** referenced by engine/ai/sim — except `moveUnit` (1589) writes render-animation scalar fields (`u._animFrom/_animStart/_animDur`, `G._animUntil`) and `moveAnimDur` (1588) reads `speed/SPEEDS`. Keep `moveUnit` writing those plain-number fields (they're harmless in headless; the renderer reads them in Plan 2). Move `moveAnimDur` into `engine/` for now (it's pure arithmetic on `state.speed`); it does not run in headless.
- **Existing proof-of-concept harnesses** in `/tmp/` (e.g. `br_parity.mjs`, `br_results_baseline.json`, `br_stubs.js`) show the "extract script body, stub THREE/DOM, run headless" approach already works — use them as a reference for Task 0, but the committed harness lives in the repo.
- **Node:** v22.22.0, npm 10.9.4. No network needed for the headless core (THREE is only imported by render, which this plan doesn't run).

### Module manifest (what goes where — source line refs into the current file)

Bin every top-level declaration into these modules. Within a module, **keep the original source order** to minimise diff noise and preserve any declaration-order dependencies.

**`src/core/`**
- `rng.js` — `mulberry32` (843), and the seeded helpers `rnd`/`rint`/`pick` (845-847) re-expressed against `state.RNG` (see Task 2).
- `state.js` — the `state` object (Task 2).
- `hooks.js` — the no-op hooks object (Task 2).

**`src/shared/` (data tables; mostly frozen, except `BAL`/`FACTION_CFG` which the Lab mutates — keep them mutable `const` objects):**
- `MAP_SIZES`(615), `MIN_CITY_DIST`(616), `BAL`(631), `BAL_DEFAULTS`(699), `UNIT_TYPES`(726), `UNIT_UPKEEP`(742), `COUNTERS`(747), `TECHS`(772), `IMPROVEMENTS`(787), `FACTIONS`(800), `PLACE_NAMES`(811), `TERRAIN`(816), `RESOURCES`(830), `STRATEGIC`(840), `CITY_MAX`(1230), `GENOME_KEYS`(1006), `GENOME_BUDGET`(1007), `ARCHETYPES`(1008), `ARCH_LIST`(1016), `ARCH_COUNTER`(1019), `FACTION_ARCHETYPE`(1030), `FACTION_CFG`(1060), `FACTION_CFG_DEFAULTS`(1079), `LESSONS`(2462). Also the display aliases `TURN_CAP/ALT_WIN_TURN/SCIENCE_WIN/ECON_WIN`(621-624) — these read `BAL`, keep as getters or recompute helpers.

**`src/engine/` (pure logic):**
- map-gen: `cityMinDist`(617), `buildRegions`(~870s), `valueNoise`(856), `generateMap`(~890s) — and the map-gen helpers between 842-986 (section "2. UTIL+RNG+MAP"; `mulberry32` itself goes to core/rng).
- accessors: `currentPlayer/tileAt/unitAt/cityAt/playerById`(996-1000).
- init: `setupGame`(1083) **split** into pure core + `hooks.afterSetup()`; `shuffle`(1159), `drawName`(1160), `chooseStarts`(1162), `placeNear`(1179), `spawnUnit`(1187), `foundCity`(1197).
- economy/territory: `infraCount`(700), `resourceCap`(702), `coalitionLeaderId`(710), `challengerFactor`(718), `improvWood`(797), `improvementFor`(798), `visionBonus`(1210), `reveal`(1211), `inSightOf`(1216), `seenByPlayer`(1223), `borderRadius`(1231), `workRadius`(1232), `growCost`(1233), `growProdCost`(1235), `foodUpkeep`(1237), `cityImprovements`(1245), `cityLandCap`(1252), `maxCityLevel`(1258), `recomputeTerritory`(1264), `playerHasResource`(1279), `missingResources`(1281), `tileYield`(1283), `cityYields`(1313), `recomputeIncome`(1323), `growCities`(1338), `onCityLevel`(1345), `playerUnitCap`(1354), `playerUnitCount`(1355), `unitCost`(1357), `canAfford`(1361), `payFor`(1364), `techCost`(1367), `canResearch`(1390), `research`(1395).
- units/movement: `unitUpkeep`(743), `counterMult`(760), `unitMove`(1408), `canEnter`(1417), `isSeaTile`(1425), `isDisembarkTile`(1427), `cityHasPort`(1430), `cityCoastal`(1436), `reachable`(1437), `attackTargets`(1453), `isHidden`(1460), `moveAnimDur`(1588), `_now`(1587), `moveUnit`(1589), `transportCap`(1605), `nearbyTransports`(1607), `embarkUnit`(1611), `disembarkUnit`(1619).
- combat: `defenseBonus`(1471), `tileHeight`(1492), `elevationMult`(1495), `flankCount`(1503), `flankMult`(1508), `attackFactors`(1510), `predictCombat`(1518), `recRel`(1537), `resolveCombat`(1538), `killUnit`(1557), `captureCity`(1560), `checkElimination`(1578).
- scoring/win: `score`(3144), `checkWin`(3157).
- turn-loop: `startTurnFor`(3180), `cullForStarvation`(3241), `advance`(3260) **split** (headless core + `hooks.afterAdvance()`), `nextIndex`(3318), `endTurn`(3319) **split**, `endGame`(3494) **split** (stash + `hooks.onEndGame()`).
- pure logic currently living in UI/render sections — move here: `viewerPlayer`(2093), `canFoundHere`(2204), `shipLaunchTile`(2412), `canImprove`(2423), `improvementOptions`(2434), `dirLabel`(2456), `humanHasAction`(3303), `pivotal`(3338) (data-only beat recorder), `recordScoreSnapshot`(3597) (data-only; the SVG render stays in Plan 2), `unitValue`(3706), `unitCostVal`(3711).

**`src/ai/`:**
- genome: `normGenome`(1040), `defaultGenome`(1041), `factionArchetype`(1043), `archetypeGenome`(1048), `classifyGenome`(1050), `factionArch`(1081).
- memory (localStorage → behind `hooks`/optional, see Task 5): `freshKnowledge`(2484), `loadKnowledge`(2485), `relOf`(2499), `pairStance`(2501), `unitStat`(2509), `rivalProfile`(2510), `saveKnowledge`(2511), `L`(2512), `bump`(3141).
- decisions: `aiParams`(2517), `aiTurn`(2539), `aiResearch`(2586), `aiBuildImprovements`(2609), `aiNavalBreakout`(2638), `aiChooseBuild`(2661), `aiActUnit`(2774), `reachableEmptyEnemyCity`(2836), `capUnderThreat`(2844), `aiPickAttack`(2851), `aiStepToward`(2896), `aiStepTowardForAttack`(2902), `aiExplore`(2908), `nearestEnemyCity`(2925), `bestEnemyCity`(2927), `nearestEnemyUnit`(2938), `wantedStrategics`(2941), `depositValue`(2956), `goodSettleSpot`(2965), `findSettleSpot`(2966), `doFoundAI`(2980), `aiActTransport`(2983), `hasLandExpansion`(3011), `nearestUnsettledCoast`(3023), `aiStepShipToward`(3032), `recordGameResult`(3039).

**`src/sim/`:**
- `simOneGame`(3913), `simulateBatch`(3941), `summariseBatch`(3959). (Lab dial helpers `dialGet/Set/Default` stay with the Lab in Plan 2; `snapshotLive`/`restoreLive` are Lab-only and move in Plan 2 — the headless sim does not need them.)

> Anything not listed: re-check section A of the structural map; if still unclear, default pure logic → `engine/`, AI → `ai/`, leave render/DOM in place for Plan 2.

---

### The state-threading rule (apply uniformly)

`src/core/state.js`:

```js
// Single source of truth for all mutable game state.
// Mirrors the set that snapshotLive() in the original treats as "the game".
export const state = {
  G: null,            // big game-state object; (re)assigned by setupGame
  N: 0,               // grid size
  FR: 0,              // camera ortho half-frustum (render-only; lives here for snapshot symmetry)
  RNG: () => 0,       // current PRNG; (re)assigned by generateMap / restoreLive
  knowledge: null,    // AI institutional memory
  autoplay: false,
  speed: 'normal',
  autoTimer: null,
  autoEndTimer: null,
};
```

**Transformation rule applied during extraction — and nothing else:**
- former bare `G` → `state.G`; `N` → `state.N`; `FR` → `state.FR`; `RNG` → `state.RNG`; `knowledge` → `state.knowledge`; `autoplay` → `state.autoplay`; `speed` → `state.speed`; `autoTimer` → `state.autoTimer`; `_autoEndTimer` → `state.autoEndTimer`.
- the `const G = {...}` declaration (988) becomes the initial value assigned in `setupGame` via `state.G = {...}` (do **not** keep a separate `const G`).
- `G._headless` → `state.G._headless` (it's a field on G, so it rides along once `G` → `state.G`).
- render/DOM/log calls inside otherwise-pure functions → `hooks.X()` (see hooks list in Task 2).
- Local convenience aliasing is allowed **only for reads/mutations, never reassignment**: inside a function body you may write `const { G, N } = state;` then use `G`/`N`, **provided** that function never reassigns `G`/`N`/`RNG` (reassignment sites must use `state.RNG = …`). Reassignment sites in this codebase: `setupGame` (sets `state.G`, `state.N`), `generateMap` (sets `state.RNG`), `loadKnowledge`/`recordGameResult` (sets `state.knowledge`), scheduler toggles (`state.autoplay`, `state.autoTimer`).

`src/core/rng.js`:

```js
import { state } from './state.js';

// mulberry32 — copied verbatim from the original (line 843). Do not modify.
export function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// Seeded helpers read the CURRENT state.RNG so reseeding (generateMap) is observed.
export const rnd  = () => state.RNG();
export const rint = (n) => Math.floor(state.RNG() * n);
export const pick = (arr) => arr[Math.floor(state.RNG() * arr.length)];
```

> **Verify `mulberry32`'s exact body against line 843 before copying** — reproduce it byte-for-byte; a one-character change breaks every seed.

---

## Task 0: Capture the golden baseline (the parity oracle)

**Files:**
- Create: `/tmp/brass-baseline/capture.mjs` (scratch capture script — not committed)
- Output (committed later in Task 1): `bench/golden-baseline.json`

This runs against the **current, untouched** `/home/john/brass-and-rails.html`. It extracts the `<script>` body, stubs THREE/DOM/localStorage, forces headless, runs a fixed seed set, and records a deterministic digest per game.

- [ ] **Step 1: Write the capture script.**

Create `/tmp/brass-baseline/capture.mjs`:

```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// 1) Extract the module-body of the single <script type="module"> from the HTML.
const html = readFileSync('/home/john/brass-and-rails.html', 'utf8');
const start = html.indexOf('<script type="module">');
const bodyStart = html.indexOf('>', start) + 1;
const bodyEnd = html.indexOf('</script>', bodyStart);
let code = html.slice(bodyStart, bodyEnd);

// 2) Strip the bare `import ... from 'three...'` lines (render-only; never hit in headless).
code = code.replace(/^\s*import\s+.*from\s+['"]three.*$/gm, '');

// 3) Provide minimal globals the module touches at load / in headless.
const docStub = new Proxy({}, { get: () => () => docStub, apply: () => docStub });
globalThis.document = new Proxy({
  getElementById: () => null,
  createElement: () => docStub,
  addEventListener: () => {},
  querySelectorAll: () => [],
  body: docStub,
}, { get(t,k){ return k in t ? t[k] : () => docStub; } });
globalThis.window = { addEventListener(){}, innerWidth:1280, innerHeight:720, devicePixelRatio:1 };
globalThis.requestAnimationFrame = () => 0;
globalThis.performance = globalThis.performance ?? { now: () => 0 };
const _store = {};
globalThis.localStorage = {
  getItem: k => (k in _store ? _store[k] : null),
  setItem: (k,v) => { _store[k] = String(v); },
  removeItem: k => { delete _store[k]; },
};

// 4) Load the module body and expose simOneGame via a data: URL import.
//    Append an export of the symbols we need to drive it.
const shim = code + '\nexport { simOneGame, G, setupGame, advance, checkWin };\n';
const mod = await import('data:text/javascript;base64,' + Buffer.from(shim).toString('base64'));

// 5) Run a fixed matrix and digest each game.
function digest(G){
  // Deterministic snapshot of the finished game. Extend if drift slips through.
  const players = G.players.map(p => ({
    fac: p.faction?.id ?? p.faction,
    alive: p.alive, cities: G.cities.filter(c=>c.owner===p.id).length,
    units: G.units.filter(u=>u.owner===p.id).length,
    techs: p.techs ? [...p.techs].sort().join(',') : '',
    score: Math.round((p.stats?.score ?? 0)),
    res: { prod:p.prod|0, wood:p.wood|0, stone:p.stone|0, food:p.food|0, science:p.science|0 },
  }));
  return { turn: G.turn, winner: G.winner, winKind: G._winKind ?? null, players };
}

const SEEDS = Array.from({length: 24}, (_,i) => 1000 + i*7);
const MATRIX = [
  { count: 4, mapSize: 'normal' },
  { count: 6, mapSize: 'large'  },
  { count: 8, mapSize: 'normal' },
];
const out = { meta: { seeds: SEEDS, matrix: MATRIX, source: 'brass-and-rails.html' }, games: [] };
for (const m of MATRIX) {
  for (const seed of SEEDS) {
    mod.simOneGame(seed, m.count, m.mapSize);
    out.games.push({ seed, count: m.count, mapSize: m.mapSize, digest: digest(mod.G) });
  }
}
mkdirSync('/tmp/brass-baseline', { recursive: true });
writeFileSync('/tmp/brass-baseline/golden-baseline.json', JSON.stringify(out, null, 2));
console.log('captured', out.games.length, 'games');
```

- [ ] **Step 2: Run it and confirm it produces output.**

Run: `node /tmp/brass-baseline/capture.mjs`
Expected: prints `captured 72 games` and writes `/tmp/brass-baseline/golden-baseline.json` (non-empty, valid JSON).

> If `simOneGame`'s signature differs from `(seed,count,mapSize)`, read line 3913 in the source and adjust the call + the export shim. If the digest comes out with `winner: null` for most games, the sim may not be reaching a win condition in the default turn cap — that's fine as long as it's **deterministic** (same input → same digest); re-run twice and confirm the two JSON files are byte-identical (`node -e "import('node:fs').then(fs=>console.log(fs.readFileSync('/tmp/brass-baseline/golden-baseline.json','utf8')===fs.readFileSync('/tmp/brass-baseline/golden-baseline.json','utf8')))"` — or capture to two files and `diff`).

- [ ] **Step 3: Determinism check — run twice, diff.**

Run:
```bash
node /tmp/brass-baseline/capture.mjs && cp /tmp/brass-baseline/golden-baseline.json /tmp/brass-baseline/run1.json
node /tmp/brass-baseline/capture.mjs && diff /tmp/brass-baseline/golden-baseline.json /tmp/brass-baseline/run1.json && echo "DETERMINISTIC"
```
Expected: `DETERMINISTIC` (no diff). If they differ, the current game has non-seeded nondeterminism — STOP and report; parity is impossible until that's found (re-check §D of the structural map: there should be zero `Math.random`).

(No commit yet — the repo doesn't exist. Task 1 creates it and commits the baseline.)

---

## Task 1: Scaffold the repo

**Files:**
- Create: `~/brass-and-rails/` (git repo)
- Create: `~/brass-and-rails/package.json`, `vite.config.js`, `.gitignore`, `README.md`
- Create: `~/brass-and-rails/reference/original.html` (frozen copy of the current file)
- Create: `~/brass-and-rails/bench/golden-baseline.json` (from Task 0)
- Create dirs: `src/core src/shared src/engine src/ai src/sim`

- [ ] **Step 1: Init repo and directory tree.**

```bash
mkdir -p ~/brass-and-rails/src/{core,shared,engine,ai,sim} ~/brass-and-rails/bench ~/brass-and-rails/reference
cd ~/brass-and-rails && git init -q && node --version
cp /home/john/brass-and-rails.html ~/brass-and-rails/reference/original.html
cp /tmp/brass-baseline/golden-baseline.json ~/brass-and-rails/bench/golden-baseline.json
```

- [ ] **Step 2: `package.json`.**

Create `~/brass-and-rails/package.json`:

```json
{
  "name": "brass-and-rails",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "sim": "node src/sim/cli.mjs",
    "sim:parity": "node src/sim/parity.mjs"
  },
  "devDependencies": {
    "three": "0.160.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 3: `vite.config.js`** (multi-page wired in Plan 2; minimal valid config now).

Create `~/brass-and-rails/vite.config.js`:

```js
import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
```

- [ ] **Step 4: `.gitignore`.**

Create `~/brass-and-rails/.gitignore`:

```
node_modules/
dist/
.DS_Store
*.log
```

- [ ] **Step 5: `README.md`** (short; points at the spec).

Create `~/brass-and-rails/README.md`:

```markdown
# Brass & Rails

Darlington-themed 4X. Refactored from a single HTML file into an ESM module tree.
- `src/core` — state, rng, hooks  ·  `src/shared` — data tables
- `src/engine` — pure game logic  ·  `src/ai` — decisions + learning  ·  `src/sim` — headless batch runner
- `reference/original.html` — frozen pre-refactor source (parity oracle)
- `bench/golden-baseline.json` — committed parity baseline; `npm run sim:parity` must match it.

Design + plan: see `strange_rambling_svelte/docs/superpowers/{specs,plans}/2026-06-01-brass-and-rails-*`.
```

- [ ] **Step 6: Install deps and commit the scaffold.**

```bash
cd ~/brass-and-rails && npm install
git add -A && git commit -q -m "scaffold: repo, vite config, frozen reference, golden baseline

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```
Expected: one commit; `node_modules`/`dist` ignored.

---

## Task 2: Core — state, rng, hooks

**Files:**
- Create: `src/core/state.js`, `src/core/rng.js`, `src/core/hooks.js`

- [ ] **Step 1: `state.js`** — exactly the object from the "state-threading rule" section above.

- [ ] **Step 2: `rng.js`** — exactly the module from the "state-threading rule" section above, with `mulberry32` copied **verbatim** from `reference/original.html` line ~843 (verify the body matches before saving).

- [ ] **Step 3: `hooks.js`.**

Create `src/core/hooks.js`:

```js
// Presentation seam. Engine/AI/sim call these instead of touching render/DOM.
// All default to no-ops (headless). The browser layer (Plan 2) overrides them.
export const hooks = {
  log(/* tag, msg */){},
  afterSetup(){},          // was: buildStaticScene/reframeCamera/rebuildDynamic/refreshAll/homeCamera
  afterAdvance(){},        // was: HUD/scene refresh + scheduler tick on the non-headless path
  onEndGame(/* winner, kind */){}, // was: end modal + marathon + recordGameResult
  refreshTile(/* x, z */){},
  toast(/* msg */){},
};
export function setHooks(overrides){ Object.assign(hooks, overrides); }
```

- [ ] **Step 4: Syntax check.**

Run: `cd ~/brass-and-rails && node --check src/core/state.js && node --check src/core/rng.js && node --check src/core/hooks.js && echo OK`
Expected: `OK`.

- [ ] **Step 5: Commit.**

```bash
git add -A && git commit -q -m "core: state object, mulberry32 rng, no-op hooks seam

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extract `shared/` (data tables)

**Files:**
- Create: `src/shared/data.js` (single module re-exporting all tables — they're const data, one file is fine and keeps cross-references simple)

- [ ] **Step 1: Move the data tables.**

Copy the declarations listed under `src/shared/` in the manifest from `reference/original.html` into `src/shared/data.js`, **in source order**, converting each `const X = …` to `export const X = …`. These tables are plain data with no `state`/`hooks`/`RNG` references (verify: if a table value calls `rnd()` or reads `G`, it's mis-binned — move that piece to engine). For the display aliases that read `BAL` (`TURN_CAP` etc., 621-624), export them as live getters so Lab mutation of `BAL` is observed:

```js
export const winTurns = () => BAL.altWinTurn;   // adapt names to the originals
```
(Only do this if the originals are used as live values; if they're only read once at load, a plain `export const` is fine — match original semantics.)

- [ ] **Step 2: Syntax + self-import check.**

Run: `cd ~/brass-and-rails && node -e "import('./src/shared/data.js').then(m=>console.log('exports:', Object.keys(m).length))"`
Expected: prints a positive export count, no errors.

- [ ] **Step 3: Commit.**

```bash
git add -A && git commit -q -m "shared: extract data tables (BAL, FACTIONS, TERRAIN, UNIT_TYPES, TECHS, ...)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Extract `engine/`

**Files:**
- Create: `src/engine/map.js` (map-gen + accessors + setup/spawn), `src/engine/economy.js`, `src/engine/units.js`, `src/engine/combat.js`, `src/engine/turn.js`, `src/engine/index.js` (barrel re-export).

> Split by the manifest groupings. Files that call each other import by name. Use a barrel `engine/index.js` that re-exports everything so `ai/` and `sim/` can `import * as engine` without caring about internal file layout.

- [ ] **Step 1: Move engine declarations** into the files above (source order within each), applying the transformation rule:
  - `import { state } from '../core/state.js';` and use `state.G`, `state.N`, etc.
  - `import { rnd, rint, pick, mulberry32 } from '../core/rng.js';`
  - `import { hooks } from '../core/hooks.js';`
  - `import * as D from '../shared/data.js';` (or named imports) for data tables.
  - Split the three straddling functions:
    - `setupGame`: keep all pure init; replace the `if(!G._headless && renderer){…}` render block with `hooks.afterSetup();` (the hook is a no-op in headless). The `if(typeof document!=='undefined'){ panel toggles }` block (1142-1146) → drop it here (DOM is Plan 2; move those toggles into `hooks.afterSetup` in Plan 2).
    - `advance`: keep the headless branch as the core; replace the non-headless render/scheduler tail with `hooks.afterAdvance();` Keep `if(state.G._headless){ if(p.isAI){ aiTurn(p); checkWin(); } return; }` working (it will call `ai`'s `aiTurn` — import it).
    - `endGame`: keep `state.G.gameOver=…; state.G.winner=…; state.G._winKind=…;` then `hooks.onEndGame(winner, kind); if(state.G._headless) return;` — actually keep the original `if(G._headless) return;` immediately after stashing, and put the DOM/marathon/`recordGameResult` tail inside `hooks.onEndGame` (Plan 2 supplies it). For the headless sim, `recordGameResult` must NOT run (preserve that — the sim reads `state.G.winner` directly).
  - `logMsg` is a UI function (Plan 2); engine callers of `logMsg(tag,msg)` → `hooks.log(tag,msg)`.
  - `aiTurn`/`aiResearch`/etc. live in `ai/` — `engine/turn.js` imports them from `../ai/index.js` (see Task 5; if extracting engine before ai, temporarily import will fail the run test — that's fine, the run test is Task 7 after ai exists; the per-task check here is `node --check` only).

- [ ] **Step 2: Per-file syntax check.**

Run: `cd ~/brass-and-rails && for f in src/engine/*.js; do node --check "$f" || echo "FAIL $f"; done; echo done`
Expected: `done` with no `FAIL` lines. (Full import resolution is checked in Task 7, after `ai/` exists.)

- [ ] **Step 3: Commit.**

```bash
git add -A && git commit -q -m "engine: extract map-gen, economy, units, combat, turn-loop (state-threaded, hooks seam)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Extract `ai/`

**Files:**
- Create: `src/ai/genome.js`, `src/ai/memory.js`, `src/ai/decide.js`, `src/ai/index.js` (barrel).

- [ ] **Step 1: Move AI declarations** per the manifest, applying the transformation rule. Imports: `state`, `rnd/rint/pick`, data tables, and `import * as engine from '../engine/index.js';` for the engine functions AI calls (`unitMove`, `attackTargets`, `canAfford`, `research`, `spawnUnit`, `moveUnit`, `resolveCombat`, `recomputeIncome`, etc.).
  - **localStorage:** `loadKnowledge`/`saveKnowledge` touch `localStorage`. In the headless core there is no `localStorage`. Guard them: `if (typeof localStorage === 'undefined') { state.knowledge = freshKnowledge(); return; }` at the top of `loadKnowledge`, and make `saveKnowledge` a `try/catch` that no-ops when `localStorage` is undefined (the original already wraps in try/catch — keep that; just also guard the read). The headless sim never calls `recordGameResult` (endGame early-returns), so AI memory stays clean.

- [ ] **Step 2: Per-file syntax check.**

Run: `cd ~/brass-and-rails && for f in src/ai/*.js; do node --check "$f" || echo "FAIL $f"; done; echo done`
Expected: `done`, no `FAIL`.

- [ ] **Step 3: Commit.**

```bash
git add -A && git commit -q -m "ai: extract genome, memory (localStorage-guarded), decisions, learning

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Extract `sim/` and the headless entrypoint

**Files:**
- Create: `src/sim/run.js` (`simOneGame`, `simulateBatch`, `summariseBatch`), `src/sim/cli.mjs` (CLI for `npm run sim`).

- [ ] **Step 1: Move sim declarations** per the manifest. `simOneGame` must set `state.G._headless = true` **before** calling `setupGame` (preserve the original ordering at line 3914). Imports: `state`, `import * as engine from '../engine/index.js';`, `import * as ai from '../ai/index.js';` (for `aiTurn` if `simOneGame` drives turns directly — match the original's call structure at 3913-3940, which loops `nextIndex`/`advance`/`checkWin`).

- [ ] **Step 2: `cli.mjs`** — a thin runner:

```js
import { state } from './core/state.js';     // adjust relative paths to actual location
import { simulateBatch, summariseBatch } from './run.js';

const n = Number(process.argv[2] ?? 25);
const count = Number(process.argv[3] ?? 6);
const mapSize = process.argv[4] ?? 'normal';
const res = await simulateBatch(n, { count, mapSize, seed0: 1000 });
console.log(JSON.stringify(summariseBatch ? summariseBatch(res) : res, null, 2));
```
> Adapt argument shape to the real `simulateBatch(n, opts)` signature (line 3941). If `simulateBatch` is `async` and uses snapshot/restore (Lab-only), strip the snapshot/restore usage for the CLI path — the CLI runs fresh games, no live state to protect.

- [ ] **Step 3: Syntax check.**

Run: `cd ~/brass-and-rails && for f in src/sim/*.js src/sim/*.mjs; do node --check "$f" || echo "FAIL $f"; done; echo done`
Expected: `done`, no `FAIL`.

- [ ] **Step 4: Commit.**

```bash
git add -A && git commit -q -m "sim: extract headless batch runner + npm run sim CLI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: The parity gate — prove the modules reproduce the baseline EXACTLY

**Files:**
- Create: `src/sim/parity.mjs`

This is the acceptance test for the whole plan. It imports the **real extracted modules**, runs the exact same seed matrix as Task 0, digests identically, and asserts deep equality with `bench/golden-baseline.json`.

- [ ] **Step 1: Write the parity runner.**

Create `src/sim/parity.mjs`:

```js
import { readFileSync } from 'node:fs';
import { state } from '../core/state.js';
import { simOneGame } from './run.js';
import assert from 'node:assert/strict';

// Same digest as the Task-0 capture script — keep them identical.
function digest(G){
  const players = G.players.map(p => ({
    fac: p.faction?.id ?? p.faction,
    alive: p.alive, cities: G.cities.filter(c=>c.owner===p.id).length,
    units: G.units.filter(u=>u.owner===p.id).length,
    techs: p.techs ? [...p.techs].sort().join(',') : '',
    score: Math.round((p.stats?.score ?? 0)),
    res: { prod:p.prod|0, wood:p.wood|0, stone:p.stone|0, food:p.food|0, science:p.science|0 },
  }));
  return { turn: G.turn, winner: G.winner, winKind: G._winKind ?? null, players };
}

const golden = JSON.parse(readFileSync(new URL('../../bench/golden-baseline.json', import.meta.url)));
let pass = 0, fail = 0;
for (const g of golden.games) {
  simOneGame(g.seed, g.count, g.mapSize);
  const got = digest(state.G);
  try { assert.deepEqual(got, g.digest); pass++; }
  catch (e) {
    fail++;
    if (fail <= 3) {
      console.error(`\n DRIFT seed=${g.seed} count=${g.count} ${g.mapSize}`);
      console.error('  expected:', JSON.stringify(g.digest));
      console.error('  got     :', JSON.stringify(got));
    }
  }
}
console.log(`\nparity: ${pass}/${pass+fail} games match`);
if (fail) { console.error(`PARITY FAILED: ${fail} games drifted`); process.exit(1); }
console.log('PARITY OK');
```

> Adjust the two relative-import paths and the `simOneGame` import to wherever Task 6 placed `run.js`. The digest function MUST be character-identical to Task 0's.

- [ ] **Step 2: Run the parity gate.**

Run: `cd ~/brass-and-rails && npm run sim:parity`
Expected: `parity: 72/72 games match` then `PARITY OK` (exit 0).

- [ ] **Step 3: If it fails — debug the drift, do NOT relax the test.**

For the first drifting `seed`, the mismatch field localises the bug:
  - `winner`/`winKind`/`turn` differs from very early → a turn-loop or win-check wiring error (check `advance` split, `checkWin`, `nextIndex`).
  - `players[i].res` differs → an economy formula or income-recompute ordering error.
  - `cities`/`units` differ → spawn/found/capture/cull wiring.
  - everything differs → almost certainly an RNG mis-wire (a `state.RNG` reassignment missed, or `rnd/rint/pick` not reading current `state.RNG`), or a function silently undefined (a missing import resolving to `undefined` and being called).
Add a focused trace for that one seed (log `state.G.turn` + a per-turn checksum) against a same-seed run of `reference/original.html` via the Task-0 harness to find the first diverging turn. Fix the **wiring** (a missed `state.` prefix, a wrong import, a dropped line), never the baseline. Re-run until `PARITY OK`.

- [ ] **Step 4: Commit.**

```bash
git add -A && git commit -q -m "sim: parity gate — modules reproduce golden baseline exactly (72/72)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Smoke the `npm run sim` CLI + tag the milestone

- [ ] **Step 1: Run a batch through the public CLI.**

Run: `cd ~/brass-and-rails && npm run sim 10 6 normal`
Expected: prints a JSON batch summary (win counts per faction, avg turns, etc.) without error.

- [ ] **Step 2: Re-run parity once more (regression guard) and tag.**

```bash
cd ~/brass-and-rails && npm run sim:parity && git tag phase0-headless-core && git log --oneline | head -8
```
Expected: `PARITY OK`; tag created.

---

## Self-review (run after writing the plan; fix inline)

- **Spec coverage:** This plan implements the §3.2 module tree (core/shared/engine/ai/sim), §3.1 "pure logic, zero render/DOM" invariant, the §8 Phase-0 "centralize RNG + prove parity" requirement, and the §10 risk mitigation (seed-fixed exact parity). Render/game/lab pages + deploy are deliberately deferred to Plan 2 (browser pages). Lab `UNIT_CFG`/dashboards = Phase 2 spec. Forge = Phase 3 spec.
- **Placeholder scan:** no TBD/TODO. Where exact line bodies can't be inlined (it's a 3650-line extraction), the manifest gives source line refs + the single transformation rule + the parity gate as the safety net — that is the executable content, not a placeholder.
- **Type/name consistency:** `state` object shape is defined once (Task 2) and used identically in rng.js, parity.mjs, cli.mjs. `hooks` names (`afterSetup/afterAdvance/onEndGame/log/refreshTile/toast`) are fixed in Task 2 and referenced by the same names in Task 4. `digest()` is defined identically in Task 0 and Task 7 (explicitly called out). `simOneGame(seed,count,mapSize)` signature used consistently in Tasks 0/7/8 (with a guard to verify against source line 3913).
- **Ordering risk:** engine (Task 4) imports ai (Task 5) for `aiTurn`; ai imports engine. This mutual import is fine in ESM (resolved at first call, not load) — that's why per-task checks are `node --check` (syntax only) and the first full run is Task 7, after both exist.
