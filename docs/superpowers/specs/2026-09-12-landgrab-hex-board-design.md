# Landgrab: the hex board

**Date:** 2026-09-12
**Status:** approved (autonomous run — Full grade)
**Supersedes the map half of:** `2026-09-12-landgrab-v2-design.md`

> John: *"convert the map to using hex atoms vs the current snapped to grid
> reference we have. Entire map of unclaimed hex grids, and then map the claims
> to current activity. do this autonomously"*

## What changes, and what deliberately does not

The map becomes a board. A fixed honeycomb is drawn over the whole map — every
hex is ground, whether anybody has been there or not — and the hexes somebody
holds are filled in their colour. The travel-snapped silhouette goes: no
dissolve, no Chaikin, no organic blobs.

**The scoring atom does not move.** `geo_capture_events` stays keyed on the
z19 square cell, ownership stays the decayed argmax over those cells, and the
ledger is not re-ingested. This is the "hex skin" route from the 2026-09-12
feasibility answer: two days, reversible, no migration, and no risk to five
people's movement history. Every number on the page — cells, km², share of
Darlington, the Sunday letter — keeps meaning exactly what it meant yesterday.

## The lattice

A pointy-top axial hex grid laid out in **z19 slippy tile units** — the same
coordinate frame the ledger is keyed in, so cell → hex is arithmetic with no
projection step of its own.

| Quantity | Value |
|---|---|
| Circumradius `HEX_R` | `sqrt(2 / (3·sqrt(3)))` = 0.620403 tile units |
| Area | exactly **1 tile unit²** — a hex is one cell of ground, by construction |
| Flat-to-flat width | `sqrt(3)·R` = 1.074570 units ≈ **47.6 m** at Darlington |
| Vertex-to-vertex height | `2R` = 1.240806 units ≈ 55.0 m |

Equal area is the whole point: `cellAreaM2` is already the area of one hex, so
no threshold, no leaderboard and no sentence anywhere on the site needs
retuning. Chunkier hexes would read better as a board and would have made every
number on the page disagree with the letter that went out on Sunday.

Axial (q, r) from world (wx, wy):

    q = ((sqrt(3)/3)·wx − (1/3)·wy) / R
    r = ((2/3)·wy) / R                     then cube-rounded

Inverse:

    wx = R·sqrt(3)·(q + r/2)
    wy = R·(3/2)·r

## Which hexes a player holds

Both directions of the square→hex mapping, unioned:

1. the hex whose interior contains the **cell's centre**; and
2. any hex whose own **centre falls inside the cell** (at most six candidates —
   a qualifying hex centre lies within 1.327 units of the home hex centre, and
   the second neighbour ring starts at 1.861).

One direction alone leaves holes: hex area equals cell area, so on average
exactly one cell centre lands per hex — meaning some hexes get two and some get
none, and a solid block of owned ground would be drawn with speckle through it.
The union is gap-free across any solid block and feathers by at most one hex at
an edge.

Measured over a 12×12 block of Darlington: 148 hexes for 144 cells, of which
**138 are fed by exactly one cell, 10 by two, and none by three**. So at the
shipped size the board is very nearly a relabelling of the ledger.

A hex's owner is the **argmax of the summed `TileOwnership.score` of the cells
that contributed to it**, ties broken by the most recent contributing
`lastEventAt` and then by subject name — the same ladder `standingsAt` uses, so
a contested hex resolves the way a contested cell does. Summing and
strongest-single-cell agree at the shipped size, since no hex has three
claimants; summing is the rule that stays right if `HEX_R` is ever retuned.

Because the mapping is not one-to-one, the hex count differs slightly from the
cell count. **The cell count stays the number of record.** Nothing on the page
reports a hex count.

**A small holding inside a stronger one is under-drawn, and can vanish.** A hex
goes wholly to one person, so a cell can contribute only to hexes somebody else
wins outright: a lone cell inside a 7×7 block at nine times the score draws
nothing at all 14% of the time, and a 2×2 inside one draws fewer than four
hexes 32% of the time. That is quantisation — at 47 m a single cell inside
somebody else's ground is below the board's resolution — not a scoring change,
and it is one more reason the cell count is the number of record. The map key
keys its isolate control off the DRAWN board rather than off the leaderboard,
so a player the board cannot show cannot be isolated into a blank map.

## The payload

`territory` (dissolved, smoothed rings) and `handovers.regions` leave the
payload entirely — nothing else reads them, and dissolving for display was the
thing being reversed. In their place:

```ts
/** Row-major delta-packed axial pairs: [q0, r0, dq1, dr1, …]. */
export interface PlayerHexes { subject: string; packed: number[] }

hexes: PlayerHexes[];
hexHandovers: { cells: number; packed: number[] };
territoryBounds: LatLonBounds | null;
```

Sorted by (r, q) and delta-encoded, a hex costs about four bytes: ~19k held
hexes land near 80 KB, against the several hundred smoothed rings they replace.
The client unpacks and builds the six corners itself.

`territoryBounds` is the bbox of the held hexes, for the map's **All** view —
the only thing `territory` was still needed for once the drawing changed.

## Rendering

`TerritoryMap.svelte` draws, bottom to top:

1. **The unclaimed mesh** — one line-only collection, regenerated for the
   current viewport on `moveend`. Skipped entirely when a hex would render
   narrower than `MESH_MIN_PX` (9 px, about Mapbox zoom 13.1 — **Mapbox GL
   renders 512 CSS px per tile**, not the 256 the slippy convention uses) or
   when the viewport would need more than `MESH_MAX_HEXES` (6,000); line
   opacity fades in over zoom 14 → 15.5, to the token's own 16% tint and no
   further, so it is neither a grey wash nor invisible. Regeneration is skipped
   when the (q, r) range has not actually moved.
2. **One collection per player**, hatched and filled as today, but one polygon
   per hex instead of one per dissolved component. The per-hex outline is a zoom
   expression (`0` at z12 → `1.1` at z16): zoomed out the fills read as solid
   territory, zoomed in the honeycomb appears.
3. **The handover pulse** — the changed cells' hexes, dashed and pulsing at
   ≤20 fps, unchanged in behaviour.

Territory and pulse redraw on separate effects, and a player's layer is skipped
when the `packed` array it was built from is the same array — so moving the
handovers does not rebuild ~19k rings for five people.

Corner→lat/lon conversion memoises the row's four distinct `wy` values, which
turns ~114k inverse-Mercator calls into a few hundred; longitude is linear in
`wx` and needs no trig at all.

## The drill is untouched

A tap still arrives as a lat/lon and still resolves through `tileAt()` to a
z19 cell, so `/projects/landgrab/geo?x&y`, the region history, the flip
timeline and the battle table all work exactly as they did. Tapping a hex opens
the history of the ground under it.

## Module placement

`src/lib/geo/hex.ts` is **client-safe**, and says so in its header. The blanket
"nothing under `src/lib/geo` may be imported by a client component" exists
because a claim ring's vertices are real GPS fixes for five people; this module
is lattice arithmetic whose signatures carry integers and a viewport. The page
already imports `$lib/geo/tiles` for exactly this reason
(`+page.svelte:27-29`), and `hex.ts` imports nothing beyond it.

## Decision Log

| # | Decision | Options considered | Why | Reversibility |
|---|---|---|---|---|
| 1 | Hex skin over the square ledger, not a hex scoring atom | (a) skin; (b) re-key `geo_capture_events` on (q, r) and re-ingest | The visual question is answered in two days with nothing at stake, and the 90-day trail retention makes a lossless re-ingest possible until late October if he wants the deeper change after seeing this | Total — delete one module and one render path |
| 2 | Hexes equal-area to the z19 cell (~47.6 m across) | equal area; 2×; 4× | Every threshold, board, letter and share number is expressed in cells; a chunkier hex makes all of them disagree with the page they sit on | Change one constant; the payload shape does not move |
| 3 | Pointy-top axial | pointy-top; flat-top | Rows are horizontal, which matches how a reader scans a map, and the row-major packing and the `wy` memoisation both fall out of it | One constant table |
| 4 | Union of both square→hex directions | centre-in-hex only; hex-centre-in-cell only; union | Either alone speckles a solid block, because equal area means ~1 centre per hex on average rather than exactly 1 | Local to one function |
| 5 | Drop `territory` and `handovers.regions` from the payload | keep both; drop both | Nothing else reads them, and they are the thing being reversed. `dissolveTiles` stays in `$lib/geo` with its own tests — it is a library primitive, not landgrab's private helper | Re-add two fields |
| 6 | Mesh generated client-side per viewport | server-side for the focus bounds; client per viewport | Only the browser knows where the reader has panned, and "the entire map" is the ask | — |
| 7 | Mesh hidden below ~zoom 14 | always draw; hide below a zoom; hide above a count | At 47.6 m a town-wide view is tens of thousands of hexes and the mesh becomes a grey wash. Both a px floor and a count cap, because either alone fails at one end | Two constants |
| 8 | Keep "cells" as the unit word in every sentence and number | rename to "hexes" | The Sunday letter, the boards and the drill all say cells, and they are computed from cells. Only the strap describes the shape | Copy-only |
| 9 | Resolve any `var(--name)` in the map adapter, not just `--accent` | leave it; parse the name | The mesh wants `--line-strong`. Both existing callers (`var(--accent)`, `var(--accent, #c4570a)`) resolve identically after the change | One line |
| 10 | `MapView.getBounds()` added to the shared adapter | reach for `.native` from the component | Every other camera read on this page goes through the adapter; one component reaching past it is how the Leaflet shape rots | One method |
| 11 | An "Unclaimed" hex swatch in the key | leave the mesh unexplained | Without it the honeycomb reads as basemap furniture rather than as ground nobody has taken, which is half the point of drawing it | Two elements |
| 12 | Keep the argmax; fix the KEY instead | guarantee every owner their home hex (overlapping); re-tune `HEX_R`; document and gate the UI | Guaranteeing a home hex breaks the one invariant the board has — that a hex belongs to one person — to paper over a resolution limit that is honestly a resolution limit | Local to one `$derived` |
| 13 | A test that DRAWS the board | unit tests only | homeserv holds no Mapbox credential, so the map is unwitnessed by automation here and always has been. `board-render.test.ts` asserts the properties a reader would otherwise have to notice by eye, and writes the picture when asked | Delete one file |

## Verification

- Unit tests for the lattice: round-trip (q,r)→centre→(q,r); area of the corner
  ring within 0.1% of `HEX_R`-derived area; `hexesForTile` covers a 6×6 block
  of cells with no gap; pack/unpack is an identity over a shuffled list;
  `hexesInBounds` returns null past its budget and otherwise covers the corners.
- `scripts/qa/landgrab-preview.mjs` gains a mesh assertion and a raised source
  cap.
- `src/lib/geo/board-render.test.ts` asserts the drawing itself: no hex belongs
  to two people, every held hex lies exactly on the unclaimed mesh, a block walk
  punches a hole rather than colouring over it, and a solid block has no speckle.
  `LANDGRAB_BOARD_SVG=<path>` writes the picture out.
- Live: the deployed page draws the honeycomb, the owner's hexes are filled,
  and a tap still opens the region drawer.

## What is deliberately NOT here

- The ledger. `geo_capture_events`, `geo_tile_state`, the dedupe index and every
  maintenance script still speak z19 squares.
- The drill. A tap resolves through `tileAt()` exactly as before.
- Any number. The leaderboard, share of Darlington, the battlegrounds, the
  next-best-move and the Sunday letter are untouched and still count cells.
