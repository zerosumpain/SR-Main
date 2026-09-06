# /drive — drag-and-drop organisation on the health design system

**Kick-off (John, 2026-09-06):** *"redesign the /drive feature. I want the focus
to be on UI functionality and design. 1. I want to be able to drag and drop to
organise files and folders together. 2. I want to mimic the design quality and
color schemes of /health. do this autonomously."*

Full-grade autonomous run. No human gate; every fork is in the Decision Log.

## What is there today

`src/routes/drive/+page.svelte`, 2,505 lines, one file — markup, state and
~1,100 lines of CSS. It wears `PageHeader` and the generic `.nm-sec` admin
register. It has three drag gestures already, and **none of them organise
anything**:

| Gesture | What it does today |
|---|---|
| Desktop → the dropzone | uploads into the current folder |
| A file tile → the desktop | native `DownloadURL` copy-out (Chromium) |
| "Move to…" dropdown | one sequential `PATCH /api/files/[id]` per file |

Folders are virtual: there is no folder table, a folder is the text before a
`/` in `workflow_files.name`, and an empty one is held open by a `.keep`
marker. So "move" is always a rename, and moving a folder is renaming every
descendant.

## What ships

**1 — Drag to organise.** A file, a multi-selection, or a whole folder can be
dragged onto a folder tile, a folder row, or any breadcrumb, and lands there.
Legality is checked before the drop is accepted (no folder into itself or its
own descendant, no no-op, no name clash). Every move is one atomic request and
is undoable for 12 seconds.

**2 — The /health register.** The page becomes a four-section document inside
`HealthShell` — the same shell `/research` and `/news` already wear — with the
grain, the ink footer, `SectionHead` mastheads, and health's tile / ranked-row /
ledger shapes.

```
A  VITALS      ink band, six instrument tiles: what is in the drive
B  THE SHELF   paper, the working surface: browse, search, drag, drop
C  KNOWLEDGE   paper, RankedMoves row shape: the RAG collections
D  LINKS OUT   ink band, TripwireTable shape: live share links
```

## Files to touch

| File | Why |
|---|---|
| `src/routes/drive/+page.svelte` | **shrinks to ~30 lines** — head tags + `<DriveHub>` |
| `src/lib/components/drive/hub/DriveHub.svelte` | NEW — shell, shared state, modals |
| `src/lib/components/drive/hub/DriveVitals.svelte` | NEW — section A |
| `src/lib/components/drive/hub/DriveShelf.svelte` | NEW — section B, the DnD surface |
| `src/lib/components/drive/hub/DriveKnowledge.svelte` | NEW — section C |
| `src/lib/components/drive/hub/DriveLinks.svelte` | NEW — section D |
| `src/lib/drive/paths.ts` | NEW — pure path/tree maths lifted out of the page |
| `src/lib/drive/move.ts` | NEW — pure drop legality + move planning |
| `src/lib/drive/stats.ts` | NEW — pure vitals figures |
| `src/routes/api/files/move/+server.ts` | NEW — one atomic batch rename |
| `src/lib/drive/*.test.ts` | NEW — the three pure modules |

Everything the page does today (upload, extract, convert, share, revoke, RAG
collections, per-folder ER policy, WebDAV, the four modals) is carried over
behaviour-for-behaviour. This is a redesign, not a backend rewrite.

## The line budget decides the shape

`check-source-footprint` is at **607,000 / 608,000** production lines — 1,000
of headroom — and refuses any new source file over 1,000 lines. So the split is
not only for readability: retiring 2,505 lines of `+page.svelte` is what pays
for the new components. Projected net: **≈ +100**. Tests are a separate bucket
with 3,011 of headroom.

## Decision Log

**D1 — `HealthShell` with `unifiedNav`, not health's own `hs-head` masthead.**
Considered (a) `unifiedNav`, which mounts the shared `SiteHeader` bar and keeps
the shell's grain and ink footer; (b) the health family's editorial masthead.
Chose (a). `/research` and `/news` are the two most recent non-health adopters
of this shell and both took `unifiedNav`; /drive is a top-level site section
(nav item 07), and the sr-design rule is one bar sitewide. `hs-head` is the
health family's legacy exception, not a pattern to spread. The shared bar has
been ink since PR #610, so section A docks under it either way. *Reversible: one
prop.*

**D2 — One thin ink band, not health's alternating dark/paper rhythm.**
/health alternates because it is a document you read. /drive is a tool you use,
and two memories point the same way: the jkai lesson (*a cover band and lettered
section heads over a working surface fight what the page is for*) and PR #611's
(*on this palette, ink is for chrome and thin bands; a tall solid ink area reads
as intensity, not editorial*). So section A is a single ~230px instrument band
docked under the nav, section D is a compact ink ledger, and the working surface
between them is paper with all the room. *Reversible.*

**D3 — Keep the lettered `SectionHead` kickers.** A/B/C/D is the system's
section rhythm and is already shared by /health, the daydream rooms and
`/jkai/builds/new`. Use the daydream variant, which is the same component plus
an `aside` snippet — section B needs one for the view toggle. *Reversible.*

**D4 — Native HTML5 drag-and-drop, no library.** Considered a pointer-event
library (svelte-dnd-action, neodrag). Chose native, because the page already
uses native DnD for upload-in and copy-out, and a pointer-event library
swallows exactly the gestures that make drag-to-desktop work. No precedent in
this repo imports a DnD library. One `dragstart` can set `DownloadURL` *and* an
internal payload on the same `dataTransfer`, so one gesture serves both
directions. *Reversible.*

**D5 — The client plans the move, the server applies it atomically.**
`POST /api/files/move` takes `{ moves: [{ id, name }] }` — explicit new names —
and applies them in one transaction. Considered having the server expand a
`{ folderPath, targetPath }` shape itself. Rejected: the client must compute the
plan anyway to check legality and name the operation in the drag ribbon, one
canonical shape keeps the endpoint at ~130 lines, and the inverse batch is a
free undo. It grants nothing new — `PATCH /api/files/[id]` can already rename to
any name, and both are owner-gated in `hooks.server.ts`. The server still
re-validates every name and refuses clashes outside the batch. *Reversible: the
endpoint is additive, the old PATCH stays.*

**D6 — "Move to…" stays.** Drag-and-drop is a pointer gesture with no keyboard
equivalent. Rather than invent one, the existing dropdown is kept as the
accessible path to the same operation, and now calls the same batch endpoint.

**D7 — Undo, not a confirm dialog.** A mis-drop is the characteristic failure of
drag-and-drop, and a confirm on every drop would make the gesture worse than the
menu it replaces. A 12-second undo strip is the cheaper answer: the move
response carries each file's previous name, so undo is the inverse batch.

**D8 — Folder tiles become drop targets, breadcrumbs too.** Dropping on a
breadcrumb is how you move something *up*, which is otherwise the one direction
a tile grid cannot express.

## Verification

- `npx vitest run src/lib/drive/` — the three pure modules, drop legality first.
- `./scripts/gate-remote.sh --build` — full gate on porkserv.
- `npx vite dev --port 5178 --host` in the worktree, then Playwright against
  `http://localhost:5178/drive`: screenshot each section, drive a real
  file→folder drag through `dispatchEvent` with a shared `DataTransfer`, and
  assert the file's name gained the folder prefix.
- Live: merge to master, wait for CI, then confirm the deployed CSS on the VPS
  carries the new scoped rules. Owner pages cannot be scripted past Google auth
  on prod, so rendering is verified on homeserv and the deploy is verified by
  asset grep — the same method `project_health_design_system` records.
