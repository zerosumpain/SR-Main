# Hometowns map page

The Vite + Pixi v8 page that draws a Hometowns town (spec §9.15, §10.10). It
imports the engine straight from `src/lib/games/hometowns/engine/`, so the
page always runs exactly the server's rules.

M0 ships **harness mode** only: open the page with `?harness=1` and the Lab's Balanced bot mayor (`engine/bots`)
founds and grows a town in an in-page county, with no server, no sign-in and
no network. The bridge to the iPhone app, the isometric renderer, plan tools,
the forecast worker and wire replay (`?wire=`) are WP6.

| Parameter | Meaning |
|---|---|
| `harness=1` | play an in-page county (anything else shows a placeholder) |
| `seed=<n>` | county seed (default 1); the same seed always grows the same town |
| `site=<0–5>` | which site around Kingsport to found on |
| `speed=<0, 1, 4, 16, 48>` | game weeks (ticks) a second |
| `lens=<landValue, pollution, access, development>` | start with a lens on |

In harness mode `window.__hometowns` exposes `hash()`, `stats()`,
`runDays(n)` and `engineHash` for Playwright.

```bash
npm --prefix games/hometowns-view install   # this folder's own node_modules only
npm --prefix games/hometowns-view run dev   # add -- --host <addr> --port <n> to serve elsewhere
npm --prefix games/hometowns-view test      # render model, harness bot, offline check
npm --prefix games/hometowns-view run check # type-check (the page, its tests and the engine it imports)
npm --prefix games/hometowns-view run build # writes dist/<ENGINE_HASH>/
```

`.npmrc` sets `legacy-peer-deps`: npm 10 crashes resolving vitest 4's optional
peers from a nested folder, and the page needs none of them.
