# Intel: full-width, source cascade, Drive ER categories, live graph filter, workbench

Date: 2026-07-27
Branch: `agent/intel-upgrade`
Mode: autonomous (Full grade — no human gates)

## The brief

Five changes to `/jkai/intel`:

1. Render full width, not a centred column.
2. When a **source** is removed, the entities that came from it are removed too.
3. Set categories on **Drive folders** to include/exclude them from ER, and define
   new ER categories that are filterable in the Intel view.
4. A dynamic filter of the graph network by keyword, category, or entities.
5. Better integrate timeline / dossier / quality / triage — it is not clear why and
   when you would use them.

## What is already there (precedent survey)

- `/jkai/intel/+page.svelte` — command centre: tiles, explorer (controls | canvas |
  detail), findings tabs. `.wrap { max-width: 1600px; margin: 0 auto }`.
- Sub-pages each set their own `max-width` (1280 / 1100 / 860).
- `deleteNoteCascade()` in `ingest.ts` already orphan-deletes entities when an
  **intel note** is deleted. Nothing calls it when the *upstream* source dies.
- `auto-extract.ts` mints one derived intel note per Drive file / research session /
  chat, tagged `metadata.autoKind` + `metadata.refId`.
- Drive folders are **virtual** — path prefixes inside `workflow_files.name`. There
  is no folder table.
- `/api/jkai/intel/network` filters by `typeId`, `community`, `minDegree`, `focus`
  + `hops` only. Analytics snapshot is cached 60 s in `analytics/load.ts`.
- Intel sub-pages have no shared nav; the landing page carries six bare text links.

## Design

### 1. Full width

Drop the centring on every `/jkai/intel/*` surface. Prose columns keep their own
measure (`quality`'s `68ch`, `search`'s reading column) — full width means the
*page* fills the viewport, not that body text runs to 2000px.

### 2. Source cascade

Root cause: `DELETE /api/files/[id]` (and the four other file-delete call sites)
removes the file row and its `file_embeddings`, but the derived intel note is a
separate row with no FK to the file — so the note, its entities, its relationships
and its timeline events all survive their source.

- New `deleteDerivedIntel(kind, refId)` in `auto-extract.ts` — finds the derived
  note(s) for an upstream item and runs `deleteNoteCascade` on each.
- Wired into every delete path: `/api/files/[id]`, both WebDAV delete sites, the
  `file-ops` and `file-store` workflow nodes.
- `deleteNoteCascade` extended to also remove what previously floated free:
  timeline events whose entity was deleted, dossier pins to deleted entities,
  insights about deleted entities, and merge tombstones pointing at a deleted
  survivor.

### 3. Drive folder ER policy + categories

Two new tables, no changes to `workflow_files`:

- `intel_categories` — analyst-defined labels (`slug`, `name`, `color`,
  `description`).
- `drive_folder_settings` — keyed on the virtual folder `path`:
  `intel_mode` (`inherit` | `include` | `exclude`) and `category_ids`.

Resolution (pure, in `source-policy.ts`, unit-tested):

- **Mode** — nearest ancestor folder with a non-`inherit` mode wins; default include.
- **Categories** — the *union* of every ancestor folder's categories, so a category
  set on `clients/` applies to `clients/acme/2026/`.

`intel_notes.categories` (jsonb `string[]`) carries the resolved category slugs at
extraction time, so the graph can filter on them without walking file paths.
Saving folder settings re-syncs every derived note beneath that path, and switching
a folder to `exclude` deletes the intel derived from files under it (using the
cascade from §2).

### 4. Dynamic graph filter

`GraphNode` grows `aliases` and `categories`; `analytics/load.ts` loads both
(categories aggregated from the entity's notes).

`/api/jkai/intel/network` accepts:

- `q` — keyword over name / aliases / summary / type
- `categories` — comma-separated slugs (OR within, AND against other filters)
- `entities` — comma-separated ids to restrict to
- `qHops` — how far to expand around a keyword match (default 1)

The filter itself lives in a pure `analytics/filter.ts` so it is testable without a
DB, mirroring the rest of that directory. The payload returns `matched: string[]`
so the client can highlight hits rather than just hiding everything else.

### 5. Workbench

The reason it is unclear *when* to use timeline/dossier/quality/triage is that they
are presented as six equal, unexplained links. Replace with:

- `IntelWorkbench.svelte` in the intel `+layout.svelte` — one nav on every intel
  surface, each destination carrying a one-line statement of the question it
  answers and a live count.
- A `+layout.server.ts` supplying those counts.
- The landing page gains a compact **loop** explainer — Capture → Triage → Quality →
  Explore → Dossier → Commission — that names which surface owns each step.
- The missing hand-offs get built: "Add to dossier" from the entity card, a
  Quality → Triage link for pairs below the auto-merge line, and a Timeline →
  dossier pin for a brushed window.

## Decision Log

| # | Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|---|
| 1 | Scope of "full width" | (a) landing page only (b) every intel surface | **(b)** | The brief says "the page" but the surfaces are one product; a full-width landing next to a 1100px Quality page reads as a bug | Yes — one CSS line each |
| 2 | Where folder settings live | (a) new column on `workflow_files` (b) new `drive_folder_settings` table keyed on path | **(b)** | Folders are virtual — there is no row to hang a column on, and a per-file column would need rewriting on every move | Yes — additive table |
| 3 | Category inheritance | (a) nearest ancestor only (b) union of all ancestors | **(b)** | Matches how people think about labels on a tree: a label on `clients/` is true of everything inside it | Yes |
| 4 | ER include/exclude default | (a) opt-in (b) opt-out | **(b) include by default** | Today every file is extracted; opt-in would silently stop the graph growing | Yes |
| 5 | Where categories are stored for filtering | (a) join file paths at query time (b) denormalise onto `intel_notes.categories` | **(b)** | The analytics snapshot is a single cached graph load; re-deriving paths per request would break the 60 s cache contract. Re-synced on settings change | Yes — recomputable |
| 6 | Keyword filter semantics | (a) matches only (b) matches + 1 hop, matches highlighted | **(b)** | A keyword filter that returns isolated dots with no edges tells you nothing about a *network* | Yes — `qHops=0` gives (a) |
| 7 | Excluding a folder | (a) stop future extraction only (b) also delete what was already extracted | **(b)** | "Exclude from ER view" means it should not be in the view; leaving stale entities is the same bug as §2 | No for the deleted rows — but they re-extract if the folder is re-included |
| 8 | Where the workbench nav lives | (a) repeat a nav on each page (b) intel `+layout.svelte` | **(b)** | One definition, one place to add a surface | Yes |
| 9 | Schema push risk | — | New tables + one nullable jsonb column, no `.unique()` on a populated table | Avoids the documented non-interactive `drizzle-kit push` traps | n/a |

## Verification

- `npm run gate` in the worktree (real `npm install`, not a symlink — see the
  shared-worktree memory).
- `npx drizzle-kit push` against dev, then prod via CI.
- `curl` the network API with `q` / `categories` / `entities` and check `matched`
  and node counts change as expected.
- Deploy via CI on merge to `master`; verify live on `strangeramblings.com`.
