# Hometowns map page

The Vite + Pixi v8 page that draws a Hometowns town (spec §9, §10.9,
§10.10). It imports the engine straight from `src/lib/games/hometowns/engine/`,
so the page always runs exactly the server's rules: it predicts the town's
next ticks, previews plans and forecasts them with the server's own code.

## Modes

| Address | What it is |
|---|---|
| `?app=1` | Inside the iPhone app: the page draws the map and speaks bridge 1 (below). It makes no network calls of its own. |
| `?harness=1` | A solo county played in a desktop browser with no server (development and Playwright). |
| anything else | A placeholder pointing at harness mode. |

Harness options: `seed=<n>` (default 1), `speed=<ticks a second: 0, 1, 4, 16, 48>`
(default Live, the dev clock's 30 s a week), `lens=<lens id>`, `kid=1`
(children's copy and dials), `bot=1` (the Lab's Balanced bot mayor, `engine/bots`, plays), `fresh=1` (do
not keep the county in this browser). A harness county is saved in the
browser and catches up the time you were away at the Live rate, so welcome
back and the time-lapse have something to show.

In harness mode `window.__hometowns` exposes `hash()`, `stats()`, `runDays(n)`,
`botHash(seed, site, days)`, `show(countyJson, townIndex, now)`,
`frameTimes(n, repaint)` and `engineHash` for Playwright.

## What the page does

- **Plan, then Build** (§9.3): road, zone, building, bulldoze, upgrade, parcel
  and eraser tools; drag a straight or L-shaped road, paint a zone rectangle,
  tap to drop a building. Ghosts are free and undoable; each one runs through
  the engine's `applyBuild` on a copy, so cost and refusals are the server's.
  "Build it!" sends the whole plan as one atomic `build` move.
- **Forecasts** (§9.8): `engine/forecast.ts` (WP6, A41) in a Web Worker: a
  cached no-plan baseline per state, a 1-seed preview, then p10–p90 of the
  plan's effect on monthly money, people and happiness per face over 8 months
  and 5 seeds, plus "ready in". The worker does one request at a time and
  only the newest job waits; the baseline is computed seed by seed as far as
  the request needs, and ahead of time only while a plan or a tool is in hand.
- **Lenses** (§9.4): all fourteen, two at Hamlet; tap a cell for its value and
  (Land value) its top three terms.
- **Inspector** (§9.5): a long press with no drawing tool (with one, the
  finger draws however long it rests first); "What would make it grow?"
  offers a ghost plan the engine accepts.
- **Mood, Why and Ledger** (§9.6): wants bubbles on the map; in harness mode a
  top bar, Wants bar, advisor cards, Why popovers, the Ledger from Town.
- **Welcome back** (§9.9): the tile-log time-lapse (skipped under Reduce
  Motion), welcome-back cards and the Morning Bulletin in harness mode.
- **Exact local ticks and the canary** (§10.9, §10.4): in the app the page runs
  its town forward at each tick boundary and checks the next frame's
  `townHash` against its prediction.
- **Rendering** (§9.15): soft 2:1 isometric or a flat top-down planning view;
  16×16 chunks repainted only when they change; render on demand; decoration
  capped, at 30 fps, and off when the phone is hot, in Low Power Mode or under
  Reduce Motion; nothing runs in the background.

## Bridge 1 (§10.9)

The app registers a `hometowns` script message handler and loads the page
with `?app=1`. Every page message carries `v: 1`. Types: `src/bridge/protocol.ts`.

App → page (`window.hometowns.*`): `boot({bridge, engineHash, wire, copyLevel,
theme, reduceMotion, locale, thermal?, lowPower?})`, `apply(frame)`,
`tool({kind, id?, variant?, rot?})`, `lens(id)`, `focus({x, y})`,
`ghost({plan})`, `commitResult({planId, ok, error?})`, `visit(view | null)`,
`renderPhotos(stories)`, `timelapse(fromTick)`, `paused(bool)`, and two v1
additions: `planEdit({action: 'commit' | 'undo' | 'clear'})` (the forecast
card's buttons) and `settings({topDown?, thermal?, lowPower?, reduceMotion?,
copyLevel?, theme?})`.

Page → app: `ready{bridge, engineHash, pageHash, paramsHash}`,
`plan{planId, ops, cost, forecast}`, `commit{planId, ops}`,
`inspect{tile, card}`, `lensChanged{id, legend, note}`, `photo`, `speak`,
`haptic`, `needResync{have}`, `needReload{engineHash, pageHash, page}` (the
wire names another page than this one; at most once a minute, never back to a
page left behind, A39; the app loads the wire's `client.page`),
`stats{fps, minFps, simMs, thermal, canary}`, `error{msg}`. `pageHash` (in
`ready`, `needReload` and `window.hometowns.pageHash`) is a v1 addition.

## Commands

```bash
npm --prefix games/hometowns-view install   # this folder's own node_modules only
npm --prefix games/hometowns-view run dev   # add -- --host <addr> --port <n> to serve elsewhere
npm --prefix games/hometowns-view test      # Vitest: render model, plan, lenses, forecast, bridge, app mode, harness bot
npm --prefix games/hometowns-view run check # type-check (the page, its tests and the engine it imports)
npm --prefix games/hometowns-view run build # writes dist/<PAGE_HASH>/mobile.html
# After any engine or page change (each has a staleness test; the deploy refuses a stale one):
node scripts/hometowns/engine-hash.mjs && node scripts/hometowns/page-hash.mjs
# Browser checks, from the repository root (WebKit is the iPhone's engine):
npx playwright install webkit
npx playwright test -c games/hometowns-view/playwright.config.ts
```

The `Hometowns page` workflow (`.github/workflows/hometowns-view.yml`) runs
the type check, Vitest and the WebKit project on a hosted runner for every
pull request that touches this folder, the engine or `scripts/hometowns/`.
porkserv cannot launch Playwright's WebKit, so that run is where the
WebKit-equals-Node hash is checked; its frame times are reported, not judged
(no GPU there).

## Releasing the page (§10.10, §13.4)

Two hashes. `ENGINE_HASH` (`src/lib/games/hometowns/engine/engine-hash.generated.ts`)
is the simulation: the page's canary and predictor compare it with the wire's
`client.engineHash`. `PAGE_HASH` (`src/lib/games/hometowns/page-hash.generated.ts`,
written by `scripts/hometowns/page-hash.mjs`) is an FNV-1a 64 over `ENGINE_HASH`
and every file this build reads besides the engine: `src/`, `index.html`,
`vite.config.ts`, `tsconfig.json`, `package.json`, `package-lock.json` and a
`public/` folder if one is added. It changes with every engine change and
also with a page-only one. `vite.config.ts` fixes the TypeScript options the
bundle is compiled with (`esbuild.tsconfigRaw`), so neither the repository's
`tsconfig.json` nor SvelteKit's generated one can change the bundle without
changing `PAGE_HASH`.

The page is served from the VPS at
`/projects/hometowns/<PAGE_HASH>/mobile.html`, one folder per page version,
and the wire's `client.page` names that path (the app loads exactly it). So the
page must be live **before** the change that names it merges, whether that is
an engine change or a page-only one. The order (spec §13.4; never
`gh pr merge --auto`, and a merge to master deploys):

0. **SR-Main framework PR (WP0)**, first release only. Merge it, then confirm
   the live sha with `npm run deploy:status`.
1. **Page PR**, first release only: `hometowns` in `STATIC_PROJECT_KEYS`
   (`src/lib/projects/visibility.ts`, a protected path, merged by hand). It
   makes the page public by default and gives it the first-party bundle CSP;
   the sandboxed CSP stops the forecast's module worker. It has no /projects
   card. Confirm the live sha with `npm run deploy:status` after the merge.
2. **`scripts/hometowns/deploy-page.sh`** from a clean checkout of the game
   branch, `--dry-run` first. It refuses an uncommitted engine or page tree, a
   stale `ENGINE_HASH` or `PAGE_HASH` (and any gitignored file in the page or
   engine tree, such as a `.env.local`), builds (a real publish always builds;
   `--no-build` and `--dist` are dry-run only), proves the folder name is
   `PAGE_HASH`, the page's `<meta name="hometowns-page-hash">` and
   `<meta name="hometowns-engine-hash">` name the generated hashes and the
   bundle carries both, then copies the folder to the VPS **additively** (no
   `--delete`). A new page, from an engine change or a page-only one, is a new
   folder; a `PAGE_HASH` already on disk must be byte-identical, so a rerun is
   a no-op, and a different build under the same `PAGE_HASH` (a build that is
   not reproducible) is refused. It ends by fetching the live URL: 200,
   `text/html`, no `sandbox` in the CSP, both markers, and every other file in
   the build served byte-identical (scripts as JavaScript). Exit 4 means the
   upload happened but the site does not serve it yet; rerun once it does.
3. **Game PR**: `node scripts/hometowns/check-client-live.mjs` must pass (it
   fetches `/projects/hometowns/<PAGE_HASH>/mobile.html` and checks both markers; the
   `Page is live` job in the `Hometowns page` workflow runs it) before the
   merge. Rerun that job after step 2. It is not a required check, so the
   person merging must read it.
4. **SR-AppleApp PR**, after the game PR's merged sha is live. Merging uploads
   to TestFlight; John tests before anyone else gets the build.

Every later engine change, and every page-only change (renderer, copy,
harness), repeats steps 2 and 3: either gives a new `PAGE_HASH` and so a new
folder.

**Old versions stay on disk.** Nothing deletes a page folder: a phone that is
still open on an old revision keeps working, and reloads (at most once a
minute, never back to a page it left, A39) when a wire names a different page
path. A page-only change keeps the engine, so the open page keeps predicting
until the reload.

`.npmrc` sets `legacy-peer-deps`: npm 10 crashes resolving vitest 4's optional
peers from a nested folder, and the page needs none of them.
