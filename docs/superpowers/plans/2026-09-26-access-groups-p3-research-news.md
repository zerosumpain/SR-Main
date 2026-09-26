# Access groups P3 (Research + News) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open `/research` and `/news` to members holding `research:*` / `news:*`, with every research row scoped to the reader and John's material never reaching them.

**Architecture:** A generic area seam (`$lib/server/area-scope.ts`: `areaAccess`, `readable`, `writable`, `canRead`, `canWrite`) resolves a request's level in an area. Research gets `research_session.principal_id` (default `'owner'`) and one guard, `requireResearchSession(event, id, intent)`, that every `[id]` route calls first; lists filter through `readable()`. Non-owner runs are capped (depth ≤ brief, 5 starts / 24 h). The news desk drops its owner-only decoration for a non-owner and gates each action on the grant it needs.

**Tech Stack:** SvelteKit 2, Drizzle, vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-access-groups-design.md` (§4, Area notes: News, Research)

## Global Constraints

- The owner's behaviour is unchanged everywhere: `areaAccess` returns `level: 'owner'` and every predicate is `true`.
- `readable`: self → `col IN (own,'household')`; all/admin → `col <> 'owner'`. `writable`: self/all → `col = own`; admin → `col <> 'owner'`.
- A session the reader may not read is **404**, never 403 (no existence oracle); one they may read but not write is 403.
- Routes that write into John's own stores stay owner-only: `to-drive`, `to-intel`, admin keys, maintenance (index-sources, reindex-facts), `source-image`, legacy `/api/deepdive` root + `/api/quickanswer`.
- Integration tests touch only their own tagged rows (shared dev DB).

### Task 1: The area seam
Create `src/lib/server/area-scope.ts` + `area-scope.test.ts` (pure predicates rendered with `PgDialect`, decision table with a faked viewer).
```ts
export type AreaAccess = { level: 'owner' | Level; own: string };
export async function areaAccess(event, area: AreaId): Promise<AreaAccess>; // owner/anonymous → owner; member holding area → level; else error(403)
export function readable(col, a): SQL; export function writable(col, a): SQL;
export function canRead(principalId: string, a): boolean; export function canWrite(principalId: string, a): boolean;
```

### Task 2: Research ownership + guard + cap
- Schema: `researchSessions.principalId text not null default 'owner'`.
- `src/lib/deepdive/session-access.server.ts`: `requireResearchSession(event, id, 'read'|'write')`, `requireSourceSession(event, sourceId)`, `researchStartAllowed(access, depth)` → `{ ok } | { error, status }` (owner always ok; others depth ∈ {instant, scan, brief}, < `RESEARCH_DAILY_RUNS` = 5 sessions with their principal created in 24 h).
- Tests: pure cap decision; integration (Task 5).

### Task 3: Scope every research route
Guard at the top of: `/research` (list via `readable`), `/research/[id]`, `/research/[id]/desk`, `/api/research` (GET list via `readable`; POST stamps `principalId: own` + cap; DELETE only `writable` ids), `/api/research/[id]/{stream,control(write),spend(?account owner only),network}`, `/api/research/source/[id]`, `/api/deepdive/[id]` (GET read, PATCH/DELETE write), and `/[id]/{data,clusters,report,stream,export/*,chat,report/custom,report/regenerate(write),synthesize(write),source-summary,explore(write+cap, child inherits principal),narrative(GET read, POST write),artefacts/[artefactId]/position(write),share(write)}`.
Catalogue: those route ids under `research:self` (writes also `research:self` — the guard decides own vs admin). Mark `research` open.
Structural test `src/lib/deepdive/route-access.test.ts`: every research route id in the catalogue has a file calling `requireResearchSession` / `requireSourceSession` / `areaAccess`.

### Task 4: News
- `loadNewsDesk({... ownerData })`: false ⇒ no correlations, no kept keys, `retainedCount` 0. `/news` load passes `ownerData: viewer is owner`.
- `/news/[source]/[id]` load returns `can: { graph, note, research }`; the page hides what it cannot do.
- `/api/news/actions`: favourite → `news:self`; graph → `jkai.intel` (writes to `writeSpace(scope)`, existing lookup in scope); note → owner only; research → `research:self` + cap, `principalId: own`.
- Catalogue: `/news`, `/news/[source]/[id]` GET, `/api/news/actions` POST under `news:self`. Mark `news` open.

### Task 5: Proof
`src/lib/deepdive/research-access.integration.test.ts`: owner session + member-A session + member-B (research:all) with tagged rows. Member A: list shows own not owner's; by-id owner session → 404 on page, API, deepdive, source; delete of owner id deletes nothing; B reads A's but PATCH/DELETE → 403; cap refuses 6th start and `investigation`. Proven red by making `readable` return `true`.

### Task 6: Gate, review, ship (as P1).
