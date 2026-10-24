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
(children's copy and dials), `bot=1` (the harness bot plays), `fresh=1` (do
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
  and 5 seeds, plus "ready in".
- **Lenses** (§9.4): all fourteen, two at Hamlet; tap a cell for its value and
  (Land value) its top three terms.
- **Inspector** (§9.5): a long press; "What would make it grow?" offers a
  ghost plan the engine accepts.
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

Page → app: `ready`, `plan{planId, ops, cost, forecast}`, `commit{planId, ops}`,
`inspect{tile, card}`, `lensChanged{id, legend, note}`, `photo`, `speak`,
`haptic`, `needResync{have}`, `needReload{engineHash}` (at most once a minute,
never back to a version left behind, A39), `stats{fps, minFps, simMs, thermal,
canary}`, `error{msg}`.

## Commands

```bash
npm --prefix games/hometowns-view install   # this folder's own node_modules only
npm --prefix games/hometowns-view run dev   # add -- --host <addr> --port <n> to serve elsewhere
npm --prefix games/hometowns-view test      # Vitest: render model, plan, lenses, forecast, bridge, app mode, harness
npm --prefix games/hometowns-view run check # type-check (the page, its tests and the engine it imports)
npm --prefix games/hometowns-view run build # writes dist/<ENGINE_HASH>/mobile.html
# Browser checks, from the repository root (WebKit is the iPhone's engine):
npx playwright install webkit
npx playwright test -c games/hometowns-view/playwright.config.ts
```

`.npmrc` sets `legacy-peer-deps`: npm 10 crashes resolving vitest 4's optional
peers from a nested folder, and the page needs none of them.
