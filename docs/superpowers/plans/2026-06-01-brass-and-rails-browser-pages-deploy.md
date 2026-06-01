# Brass & Rails — Browser Pages & Deploy (Plan 2 of Phase 0+1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the browser-facing pages on top of the parity-proven headless core: extract the THREE render layer, wire the UI to the engine via the `hooks` seam, and ship two Vite-built pages — a **lean Game** (`index.html`) and a **Lab** (`lab.html`) — replacing the hand-maintained single-file game in production.

**Architecture:** Continue in `~/brass-and-rails/` (Plan 1 left it at tag `phase0-headless-core`). Add `src/render/` (THREE scene — confined to original lines 1634-2201), `src/game/` (play UI), `src/lab/` (analytics + dials + batch-sim UI). Vite multi-page: `index.html` → Game entry (imports `engine + ai + render + game`, NOT `sim`/`lab`), `lab.html` → Lab entry (imports `engine + ai + sim + lab`, **no THREE**), `forge.html` → static placeholder (Phase 3). The `hooks` object (`src/core/hooks.js`) is populated via `setHooks(...)` by each page's entry to connect engine events to presentation. Three.js is bundled by Vite from the npm `three@0.160.0` dependency (the original CDN `<script type="importmap">` is dropped).

**Tech Stack:** Vite 5 (multi-page), three@0.160.0 (npm), Playwright (already in `~/strange_rambling_svelte/node_modules` — use `--use-angle=swiftshader` for headless WebGL screenshots), the existing `~/strange_rambling_svelte/scripts/deploy.sh` path for the static copy + VPS rsync.

**Safety:** This plan replaces the LIVE production game. Deploy (Task 6) is gated on Playwright visual + functional verification AND a human-visible screenshot review. The frozen `reference/original.html` is the visual reference. Do not deploy if the built Game page is blank, errors in console, or visibly regresses from the reference.

---

## Background the executor needs

- **Plan 1 is done.** `src/{core,shared,engine,ai,sim}` exist; `npm run sim:parity` is green (72/72); the engine/ai/sim are pure (no THREE/DOM). All mutable state is `state` (`src/core/state.js`); `rnd/rint/pick` in `src/core/rng.js`; presentation seam is `hooks` (`src/core/hooks.js`) with `setHooks(overrides)`.
- **The render boundary (original `reference/original.html`).** THREE is used only in lines **1634-2201**. Declarations to extract into `src/render/` (group sensibly, e.g. `scene.js`, `meshes.js`, `camera.js`, `loop.js`):
  - globals/materials: `renderer,scene,camera,controls,composer,passH,passV,sun`, scene groups, `fillMat`/`edgeMat`/`colorMat`, `TILE/HSCALE/UNIT_GAP`, `raycaster/pointer`, `tilePickMeshes/hovered` (1634-1643).
  - `initThree`(1645), `TiltShiftShader`(1701), `onResize`(1727), `wx`/`wz`(1735-1736), `decoAssets`(1740), `decoThin`(1758), `addTileDeco`(1764), `buildStaticScene`(1801), `refreshTile`(1821), `makeUnitMesh`/`buildUnitTemplate`(1832/1838), `makeCityMesh`/`buildCityTemplate`(1949/1955), `buildTerritory`(2025), `rebuildDynamic`(2045), `updateHighlights`/`addHL`(2098/2111), `onPointerMove`(2120), `pickTile`(2122), `reframeCamera`(2129), `homeCamera`(2143), pan state + `applyPan`(2151-2182), `animate`(2184).
  - These import `state`, `engine` (for `tileAt`, `viewerPlayer`, etc.), and `shared/data` (TERRAIN/RESOURCES colours). `reframeCamera` writes `state.FR`. `animate` calls `composer.render()`.
  - **THREE under Vite:** `import * as THREE from 'three'` and `import { OrbitControls } from 'three/addons/controls/OrbitControls.js'` (+ `EffectComposer`, `RenderPass`, `ShaderPass` from `three/addons/postprocessing/...`). Vite resolves these from the npm package; do NOT add a CDN importmap to the HTML.
  - **Engine→render coupling already isolated by Plan 1:** `moveUnit` writes plain-number anim fields (`u._animFrom/_animStart/_animDur`, `state.G._animUntil`); `animate` reads them. `moveAnimDur` is in engine. No action needed beyond importing.
- **The hooks to implement** (each page's entry calls `setHooks({...})` with real functions; defaults are no-ops so headless/sim is unaffected):
  - `afterSetup()` → build the scene + reveal the right DOM panels (was the `setupGame` block at orig 1142-1155: panel toggles + `buildStaticScene/reframeCamera/rebuildDynamic/refreshAll/homeCamera`).
  - `afterAdvance()` → the non-headless tail of `advance` (orig 3273+): `refreshHUD/rebuildDynamic/refreshAll` + the `setTimeout`-based autoplay scheduler tick.
  - `onEndGame(winner, kind)` → the end modal + marathon rematch + `recordGameResult` (orig 3498+). **Only the Game page wires this**; the Lab never calls real `endGame` (its sim path stays headless).
  - `log(tag, msg)` → append to `#logbody` (orig `logMsg` 3331-3336 body).
  - `refreshTile(x, z)` → render's `refreshTile` (orig 1821).
  - `toast(msg)` → `#toast` (orig 3587).
  - `endTurnUi()` → `document.getElementById('endturn').disabled = …` (the line Plan 1 replaced with `hooks.endTurnUi?.()` in `engine/turn.js`).
- **The page/UI split (design decision):**
  - **Game page (`index.html`)** = setup modal, play board (THREE), HUD, unit/city selection, tech panel, controls, log, AI-vs-AI **watch** with the *live per-game overlays* (brain `refreshBrain`, ticker `renderTicker`, score chart `renderScoreChart`, pivots `renderPivots`), end modal, help. These overlays are lightweight and part of watching a run, so they stay with the Game. `src/game/` owns them.
  - **Lab page (`lab.html`)** = the **AI-performance overview**: the batch-sim Lab modal (Rules dials + Houses tab + run controls → `simulateBatch`), cross-game analysis (`renderAnalysis`), unit roster (`renderRoster`), AI dossier (`renderDossier`). No THREE board — it visualises *batches*, not a live game. `src/lab/` owns them; it imports `sim`. This is where Phase 2 will add the `UNIT_CFG` editor + expanded dashboards.
  - Pure helpers `renderAnalysis`/`renderRoster`/`renderDossier` read `state.knowledge` (localStorage). On the Lab page that's fine (browser has localStorage).
- **The HTML shell to split (original lines 1-591):**
  - `<head>`: Google Fonts (Archivo Black / DM Mono / DM Sans / JetBrains Mono) — keep on both pages. Drop the THREE importmap (Vite bundles three).
  - `<style>` (10-278): one block with a `:root` design-token palette + the `sr.` monogram. Extract to `src/styles.css` (imported by both entries). Keep all tokens.
  - `<body>` (280-591): split the DOM. Game-only ids (stage/hud/selPanel/techPanel/braincol/log/controls/setup/endModal/help/ticker/scorePanel/pivots) → `index.html`. Lab-only ids (lab modal, analysis, roster, dossier) → `lab.html`. See the structural map §F for the full id inventory.
- **Playwright:** scripts live where `~/strange_rambling_svelte/node_modules/playwright` is. Launch chromium with `args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']` for software WebGL. Screenshot to a file and the controller will inspect it.

---

## Task 1: Page shells + Vite multi-page + shared stylesheet

**Files:** Create `index.html`, `lab.html`, `forge.html`, `src/styles.css`, `src/game/main.js` (stub), `src/lab/main.js` (stub), `src/forge/main.js` (stub). Modify `vite.config.js`.

- [ ] **Step 1:** Extract the `<style>` block (orig lines 10-278) verbatim into `src/styles.css` (keep the `:root` tokens, `sr.` monogram, all classes).
- [ ] **Step 2:** Create `index.html` — `<head>` with the Google Fonts links (no importmap), `<link rel="stylesheet" href="/src/styles.css">` (or `import './styles.css'` from the entry), the **game-only** body DOM (orig: stage/hud/leftcol[selPanel,ticker,scorePanel]/rightcol[techPanel,braincol]/log/controls/toast/help/setup/endModal/pivots), and `<script type="module" src="/src/game/main.js"></script>`.
- [ ] **Step 3:** Create `lab.html` — same `<head>`, the **lab-only** body DOM (the `#lab` modal contents promoted to the page body: tabs/dials/houses/run controls/results, plus `#analysis`/`#roster`/`#dossier` containers), `<script type="module" src="/src/lab/main.js"></script>`.
- [ ] **Step 4:** Create `forge.html` — minimal placeholder (`<h1>Forge</h1><p>Phase 3.</p>`) + `src/forge/main.js` empty stub. (Built so the page exists; functionality is Phase 3.)
- [ ] **Step 5:** Stub entries: `src/game/main.js` = `import '../styles.css'; console.log('game boot');`; `src/lab/main.js` similar; `src/forge/main.js` empty.
- [ ] **Step 6:** `vite.config.js` multi-page:

```js
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: './',
  build: {
    target: 'es2022', outDir: 'dist', emptyOutDir: true,
    rollupOptions: { input: {
      index: resolve(__dirname, 'index.html'),
      lab:   resolve(__dirname, 'lab.html'),
      forge: resolve(__dirname, 'forge.html'),
    } },
  },
});
```

- [ ] **Step 7:** Verify dev server boots and pages load (no module-resolution errors).

Run: `cd ~/brass-and-rails && (npm run dev &) && sleep 4 && curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:5173/index.html && curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:5173/lab.html ; pkill -f vite`
Expected: `200` for both. (Console "game boot" confirms the entry ran — verified visually in Task 3.)

- [ ] **Step 8:** Commit: `feat: page shells (index/lab/forge), vite multi-page, shared stylesheet`.

---

## Task 2: Extract `src/render/` (THREE scene)

**Files:** Create `src/render/scene.js`, `src/render/meshes.js`, `src/render/camera.js`, `src/render/loop.js`, `src/render/index.js` (barrel). (Split by responsibility; one file is acceptable if cohesive.)

- [ ] **Step 1:** Move the render declarations (orig 1634-2201, listed in Background) into `src/render/`, converting top-level `const/function` to `export`, applying the same state rule (`G`→`state.G`, `N`→`state.N`, `FR`→`state.FR`), importing engine helpers (`tileAt`, `viewerPlayer`, `unitAt`, `cityAt`, etc.) from `../engine/index.js` and data from `../shared/data.js`. Use the npm `three` + `three/addons/...` imports (no CDN importmap).
- [ ] **Step 2:** Export an `initRender()` that runs `initThree()` and wires the `setHooks({...})` render hooks (`afterSetup`, `afterAdvance` render portion, `refreshTile`). Keep `animate`'s rAF loop self-starting from `initThree` as in the original.
- [ ] **Step 3:** Syntax check: `cd ~/brass-and-rails && for f in src/render/*.js; do node --check "$f" || echo "FAIL $f"; done; echo done` → `done`, no FAIL. (Full validation is the Task-3 browser bring-up; render imports `three` which only loads in the browser/Vite, so a bare `node -e import` will fail on the `three/addons` resolution — that's expected; rely on `node --check` + Task 3.)
- [ ] **Step 4:** Commit: `render: extract THREE scene/meshes/camera/loop onto the proven core`.

---

## Task 3: Game UI + hooks → working `index.html` (single-page visual parity checkpoint)

**Files:** Create `src/game/ui.js` (HUD/selection/city/tech/log/controls/setup/end/help), `src/game/overlays.js` (brain/ticker/score/pivots live overlays), and finalise `src/game/main.js` (the entry that imports engine+ai+render+game, calls `setHooks` + boots the setup UI).

- [ ] **Step 1:** Move the play-UI functions into `src/game/ui.js`: `setupGame` DOM hooks, `renderSelPanel`/`renderCityPanel`/`inspectTile`/`renderSelPanelEmpty`(orig 2266-2456), `refreshHUD`(3343), `refreshTech`(3362), `refreshAll`(3411), `logMsg`(3331), the human action handlers (`onClick`/`selectUnit`/`selectCity`/`doFound`/`doBuild`/`doImprove`/`humanScout`/`afterAction`)(2212-2456), `buildSetupUI`/`syncSetup`/`beginGame`(3529-3585), `endGame` DOM tail + `toast`(3494-3587), `manualStep`/`maybeAutoEndTurn`/`runAutoExplore` scheduler-UI(3295-3327), the controls/keyboard event wiring (orig 3550-3585, 4203-4233). Apply the state rule + import engine/ai/render.
- [ ] **Step 2:** Move the live spectator overlays into `src/game/overlays.js`: `refreshBrain`(3381), `renderObservability`(3413), `renderScoreChart`(3623)+`DOMAINS`/`recordScoreSnapshot` caller, `renderTicker`(3667), `renderPivots`(3698). (`recordScoreSnapshot`/`pivotal` data fns are already in engine from Plan 1 — import them.)
- [ ] **Step 3:** `src/game/main.js`: import `../styles.css`; import render + game UI; `setHooks({ afterSetup, afterAdvance, onEndGame, log, refreshTile, toast, endTurnUi })` mapping to the real implementations; call `initRender()` then `buildSetupUI(); syncSetup();` and the first-run help check (orig 4242-4243). **Do NOT import `sim` or `lab`** (lean boundary).
- [ ] **Step 4:** Bring it up and smoke it with Playwright. Create `~/brass-and-rails/test/smoke-game.mjs`:

```js
import { chromium } from '/home/john/strange_rambling_svelte/node_modules/playwright/index.js';
const base = process.env.BASE || 'http://localhost:5173';
const b = await chromium.launch({ args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const pg = await b.newPage();
const errs = [];
pg.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(base + '/index.html', { waitUntil:'networkidle' });
await pg.waitForTimeout(800);
// Start a fast AI-vs-AI game from the setup modal if present, else just verify the board.
await pg.screenshot({ path:'/tmp/brass-game-setup.png' });
// Try clicking the start button (id startBtn) to enter a game.
const start = await pg.$('#startBtn'); if (start) await start.click();
await pg.waitForTimeout(1500);
await pg.screenshot({ path:'/tmp/brass-game-board.png' });
// Confirm a WebGL canvas exists and has non-trivial pixels.
const hasCanvas = await pg.$eval('canvas', c => c.width>0 && c.height>0).catch(()=>false);
console.log(JSON.stringify({ hasCanvas, errors: errs.slice(0,10) }, null, 2));
await b.close();
if (errs.length) process.exit(1);
```

Run: `cd ~/brass-and-rails && (npm run dev &) && sleep 4 && node test/smoke-game.mjs ; pkill -f vite`
Expected: `{ "hasCanvas": true, "errors": [] }`. Screenshots written to `/tmp/brass-game-*.png`.

- [ ] **Step 5:** **Controller inspects `/tmp/brass-game-board.png`** — must show the rendered isometric tilt-shift board (not blank/black), matching the look of `reference/original.html`. If blank or errored, debug (common: a missing `setHooks` wire, an engine helper not imported into render, the canvas not appended to `#stage`). Iterate until the screenshot shows a real board and `errors:[]`.
- [ ] **Step 6:** Commit: `game: play UI + live overlays + hooks wiring — index.html renders from modules`.

---

## Task 4: Lab UI → working `lab.html`

**Files:** Create `src/lab/ui.js` (analysis/roster/dossier), `src/lab/lab.js` (the batch-sim modal: dials/houses/run → `simulateBatch`), finalise `src/lab/main.js`.

- [ ] **Step 1:** Move into `src/lab/lab.js`: `dialGet/Set/Default`(3886), `LAB_DIALS`(3871), `buildLabDials`/`labResetDials`(3978/3999), `HOUSE_KNOBS`(4007)/`START_UNIT_KEYS`(4022)/`reseedFactionArchetype`(4026)/`buildLabHouses`/`labResetHouses`(4035/4097), `labShowTab`(4103), `labBarRow`/`labStatCards`/`delta`/`renderLabResults`(4112-4133), `labRun`(4183), `openLab`(4199). Import `simulateBatch`/`summariseBatch` from `../sim/run.js`. (Plan 1 stripped snapshot/restore from `sim/run.js`; the Lab page runs fresh batches, so it doesn't need live-state protection.)
- [ ] **Step 2:** Move into `src/lab/ui.js`: `renderAnalysis`(3736), `renderRoster`/`unitValue`/`unitCostVal`(3712/3706/3711 — `unitValue`/`unitCostVal` are already in engine/misc from Plan 1; import them), `renderDossier`(3420), and the wipe/close button wiring for those modals.
- [ ] **Step 3:** `src/lab/main.js`: import `../styles.css`; import lab UI + lab.js; on load, build the dials + houses and render an empty results pane; wire the Run button. **Imports `engine + ai + sim + lab`, NOT `render`** (no THREE).
- [ ] **Step 4:** Smoke with Playwright. Create `~/brass-and-rails/test/smoke-lab.mjs` (same launch boilerplate) that: loads `/lab.html`, sets the batch count low (e.g. fill `#labN`/`#labCount` to 5), clicks `#labRun` (or `#labBtnStart`), waits for results, screenshots `/tmp/brass-lab.png`, asserts the results pane populated (e.g. `#labResults` has child rows) and `errors:[]`.

Run: `cd ~/brass-and-rails && (npm run dev &) && sleep 4 && node test/smoke-lab.mjs ; pkill -f vite`
Expected: results pane populated, `errors:[]`.

- [ ] **Step 5:** **Controller inspects `/tmp/brass-lab.png`** — dials/houses render, a batch ran, win-rate bars/aggregates show. Iterate if needed.
- [ ] **Step 6:** Commit: `lab: analytics + dials + houses + batch sim — lab.html runs from modules`.

---

## Task 5: Production build + lean-boundary check

- [ ] **Step 1:** `cd ~/brass-and-rails && npm run build`. Expected: `dist/index.html`, `dist/lab.html`, `dist/forge.html` + hashed assets, no errors.
- [ ] **Step 2:** Lean-boundary check — the Game bundle must not pull in `sim`/`lab`. Inspect the build: confirm `index`'s JS chunk does not import the batch-sim/lab modules (grep the `dist/assets` chunk graph, or use `rollupOptions`/`build --mode` to print the module list). A simple check: `grep -rl "simulateBatch\|buildLabHouses" dist/assets/*index*.js` should return nothing (those symbols belong only to the lab chunk).
- [ ] **Step 3:** Serve `dist/` and re-run BOTH smokes against the built output (catches build-only breakage):

Run: `cd ~/brass-and-rails && (npx vite preview --port 4399 &) && sleep 3 && BASE=http://localhost:4399 node test/smoke-game.mjs && BASE=http://localhost:4399 node test/smoke-lab.mjs ; pkill -f vite`
Expected: both green, `errors:[]`.

- [ ] **Step 4:** Commit: `build: vite multi-page production build, lean Game boundary verified`.

---

## Task 6: Deploy to production + verify live

> Replaces the hand-maintained `static/projects/brass-and-rails/index.html`. Gated on Tasks 3-5 passing AND the controller's screenshot review.

- [ ] **Step 1:** Create `~/brass-and-rails/scripts/deploy.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
DEST=/home/john/strange_rambling_svelte/static/projects/brass-and-rails
rm -rf "$DEST"/* 
cp -r dist/* "$DEST"/
echo "copied dist -> $DEST"
ls -la "$DEST"
# Hand off to the site deploy (build + rsync to VPS + restart), per repo convention.
echo "Now run: ~/strange_rambling_svelte/scripts/deploy.sh   (to push to the VPS)"
```
Make executable. (Keep the VPS push as the existing site `deploy.sh` so we reuse the proven rsync/restart path.)

- [ ] **Step 2:** Run `~/brass-and-rails/scripts/deploy.sh` → copies the built pages into the site's static dir. Verify `static/projects/brass-and-rails/` now contains `index.html` + `lab.html` + `forge.html` + assets.
- [ ] **Step 3:** Push to the VPS via the site deploy: `~/strange_rambling_svelte/scripts/deploy.sh` (commit any needed static change on `master` first if the site deploy requires a clean tree — only `static/projects/brass-and-rails/**`, nothing else).
- [ ] **Step 4:** Verify live: `curl -sS -o /dev/null -w "%{http_code}\n" https://strangeramblings.com/projects/brass-and-rails/` → `200`; and Playwright against the live URL (`BASE=https://strangeramblings.com/projects/brass-and-rails node test/smoke-game.mjs`) → `hasCanvas:true, errors:[]`; screenshot `/tmp/brass-live.png` for the controller to confirm the live board renders. Also check `…/brass-and-rails/lab.html` loads (the published `index.html` is the Game; the Lab is the sibling page).
- [ ] **Step 5:** Commit (in the site repo, only the static project files): `Brass & Rails: ship Vite-built lean Game + Lab pages (replaces single-file)`.

---

## Self-review (run after writing; fix inline)

- **Spec coverage:** implements §3.1 three-page split (Game/Lab/Forge by where-they-run), §4 lean Game (no sim/lab import, bundle check Task 5.2), §5 Lab as a separate client-side analytics surface (seeded from existing analytics; UNIT_CFG + expanded dashboards remain Phase 2), §7 build & deploy (build → static copy → VPS). Forge is a placeholder (Phase 3). Lab auth-gating (read-only/editable) is deferred to Phase 2 with the dashboards work — note this; this plan ships the Lab functional for the authed owner on homeserv/prod, edit-gating comes next.
- **Placeholder scan:** Forge page is an intentional stub (labelled). No TBD in functional tasks.
- **Consistency:** hook names match Plan 1 (`afterSetup/afterAdvance/onEndGame/log/refreshTile/toast/endTurnUi`). `state.X` rule identical to Plan 1. `simulateBatch`/`summariseBatch` imports match `src/sim/run.js` from Plan 1.
- **Risk:** visual parity is judged by screenshot (no automated parity like Plan 1). Mitigation: `reference/original.html` is the visual baseline; both smokes assert `errors:[]` + non-blank canvas / populated results; deploy gated on controller screenshot review.
