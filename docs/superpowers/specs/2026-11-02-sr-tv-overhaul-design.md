# sr. tv overhaul — Prism look, Watch row, site projects (2026-11-02)

John: "overhaul the interface; bring some of the SR styling from the main pages; color schemes from the
apple-app and icons/logos. Also, think about how we can have marbler on there, plus the option to open
public projects from the SR site." Then: "add the family backlog so that videos shared to the apple-app
could be collected and played through sr.tv".

## Decisions (John picked every recommendation in one round)

| Question | Choice |
|---|---|
| Palette | Site structure and type (sr. mark, Inter 800, mono labels, square, no shadows) on the app's Prism **dark** palette; each tile its own Prism feature hue |
| Icons | The app icon's pixel SR (same grid, same four-corner ground) as logo and splash; a pixel icon per tile on the same kind of grid |
| Marbler | Watch now (Marbler `?tv=1`), party mode later |
| Projects | Curated "From the site" row, only public projects, opened full-screen, Back returns |
| Backlog (added) | Watch-row tile listing the family backlog's playable videos; played full-screen through the existing Play-on-TV fetch |

## Shape

- `TvStage` pours Prism dark into the site's dark tokens (`--chrome-*`, `--accent*`, `--on-ink-*`) on `.tv-screen`
  only, so every TV page and board inherits it; phones and the web games keep the site's ink.
- `pixel.ts` holds `SR_MARK` + `PRISM_GROUND` (copied from SR-AppleApp `scripts/app-icons.py`) and `TILE_ART`
  (grid + Prism hue per tile). `PixelTile.svelte` draws one as SVG.
- Menu = three rows (Games · Watch · From the site), fixed-height tiles so the footer always fits 16:9; the focused
  tile's blurb replaces the greeting line.
- Backlog: `GET/POST /api/games/tv/backlog` (requireTv). GET = `tvBacklogItems` (status new, `castRoute` fetchable,
  newest first, max 40, first names only — no emails, no notes). POST `{id}` = `prepareCast` (ready | preparing |
  fallback). The TV never marks items watched: `doneByEmail` is a person.
- Player: `<video>` over the stage, controls fade after 4 s, menu behind is `inert` and the remote skips inert
  controls (`focus.ts`). Music stops while a video plays.
- Projects: `$lib/games/tv-projects.ts` (curated keys, titles, hrefs and TV blurbs; a test pins hrefs to `PROJECT_CARDS` — a route may not import another route),
  filtered by `/projects` visibility in the page load.
- Marbler (zerosumpain/marbler): `?tv=1` hides editing/tuning controls and sliders, turns predictions off, focuses
  Next race on the results card and starts it after 15 s; OK starts it at once. Back is the TV shell's history back.

## Later

- Marbler party mode: phones back a marble before each heat, the TV runs the race, finishing order scores points
  (Marbler's phone page already runs a shared-clock family race — build on that).
- Marking a backlog video watched from the TV would need a "who" — perhaps the members seated in the party.
