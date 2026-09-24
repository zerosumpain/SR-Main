# Intel spaces and domains — design

2026-09-24. Phase 1 of personalised experiences: the intelligence graph is split
by **person** (spaces) and grouped by **origin** (domains), and family members can
sign in and see their own graph at `/jkai/intel`.

## Why

The graph is one global pool today. No intel table records whose data a row is;
entities are shared across every note that mentions them, and their summaries,
aliases and trust scores are computed over all of it. Adding family to the site
therefore means the first per-user data scoping on it. Intel goes first because
it is where the most personal material (email) lands.

Separately, `intel_notes.source` is too raw to answer "show me what came from
email / news / documents / home": news "keep" and chat captures both write
`web`, and nothing ingests Home Assistant.

## Decisions (agreed 2026-09-24)

| # | Question | Decision |
|---|---|---|
| 1 | Isolation | **Separate graph per person.** Owner column on every data row; resolution never crosses people. |
| 2 | Visibility | **Own + household.** Everyone, the owner included, sees their own space plus the shared household space. Admin does not open another person's graph. |
| 3 | Domains | **Domain grouping now; Home Assistant ingest is a later phase.** Home is an empty domain until then. |
| 4 | Phase 1 reach | **Member role + intel.** Members reach `/jkai/intel` read surfaces and connect their own Gmail. Chat, the app and the rest of the site stay owner-only. |

Rejected: Postgres row-level security with an owner-scope default — the
production app role bypasses row-level security (checked 2026-09-24), so RLS
cannot enforce this; making it work means a new DB role and an edit to the
immutable production `.env`. Rejected: one Postgres schema per person (every Drizzle table object doubles; no
precedent in the repo); a shared-entity graph filtered by contributor (summaries
and aliases leak across people — ruled out by decision 1).

## 1. Model — spaces

A **space** is a principal id from `activity_principals`, which was built with a
`'user'` kind "reserved for invited-user rollout":

- `'owner'` — the existing principal (all `AUTH_ALLOWED_EMAILS` map to it).
- one `kind:'user'` principal per family member, `external_ref` = lower-cased
  email, id `u_<short-random>`.
- `'household'` — a new `kind:'household'` principal (check constraint widened).

`space_id text NOT NULL DEFAULT 'owner'` is added to the intel tables a reader
lists directly:

`intel_notes`, `intel_entities`, `intel_relationships`,
`intel_timeline_events`, `intel_alerts`, `intel_insights`, `intel_lenses`,
`intel_dossiers`, `intel_commissions`.

Link and ledger tables (`intel_note_entities`, `intel_mentions`,
`intel_assertions`, `intel_dossier_items`, `intel_entity_merges`,
`intel_match_decisions`) are always reached through a note or entity id that is
already scoped, so they carry no column of their own. *(Trimmed from the first
draft's fifteen after reading the readers, 2026-09-24.)*

Plus `gmail_accounts.principal_id` (default `'owner'`) and, in PR B,
`drive_folder_settings.space_id` (nullable = inherit; lets the owner route a
drive folder to household).

Vocabulary stays global: `intel_entity_types`, `intel_taxonomy_*`,
`intel_categories`, `intel_resolution_labels`,
`intel_type_suggestion_dismissals`.

All new columns are plain, non-unique; each gets a `(space_id)` or
`(space_id, …)` plain index where a hot query filters on it. No unique index is
added to a populated table (see `reference_drizzle_unique_push_gotcha`). Existing
global uniques that must become per-space (`intel_insights.dedupe_key`,
`intel_lenses.slug`, `intel_dossiers.slug`) stay globally unique in phase 1 and
the writers prefix non-owner keys with the space id — avoids a unique-index
rebuild on a populated table.

The DB default is a backstop for existing rows only. **Writes must be explicit:**
both funnels — `createNote` (`ingest.ts`) and `extractIntoIntel`
(`auto-extract.ts`) — take a required `spaceId`, so `tsc` names every caller that
has not decided. Derived rows (entities, edges, mentions, assertions, timeline,
alerts) inherit the note's space inside the pipeline, never from a parameter.

### Resolution never crosses a space

- `mentionCandidates` (name / alias / email / FTS) and the embedding ANN search
  filter `space_id = note.space_id`.
- Auto-merge, `mergeEntities` and bulk review refuse a pair whose spaces differ
  (throws; unit-tested).
- Edge upsert/dedupe is keyed within a space; both endpoints must share it.

So "Tesco" in my space and "Tesco" in household are two entities, and nothing
computed from my email can surface in someone else's graph.

## 2. Reads are scoped everywhere

`$lib/jkai/intel/scope.ts` (pure) + `scope.server.ts`:

- `type IntelScope = readonly string[]` — the space ids a reader may see.
- `scopeForPrincipal(id) = [id, 'household']`.
- `OWNER_INTEL_SCOPE = ['owner', 'household']` — used by every owner-only
  background consumer.
- `scopeFromEvent(event)` — resolves the session email → principal → scope. The
  LAN dev bypass resolves to the owner. **Never** accepts a space from the
  request; the UI's space chips can only *narrow* within the resolved scope.

Every reader of intel data takes a scope and adds `space_id IN scope`:

- analytics `load.ts` — the 60s snapshot cache is keyed by the scope's sorted
  join, so every panel under one scope still agrees.
- `/api/jkai/intel/*` read endpoints (network, evidence-network, source-facets,
  entity-card, mentions, entities, notes, search, timeline, layout badge
  counts).
- jkai: `buildKnowledgeContext`, `searchIntel` / `knowledge_search`, the
  `intel-graph` toolset, `intel-query` / `intelligence` workflow nodes,
  `fetchMentionIndex` (linkify + hover cards) — all `OWNER_INTEL_SCOPE`.
- daydream readers, `news/correlate.server.ts`, `thread-graph.server.ts`,
  `memory/graph.server.ts`, `context-panel/drill.server.ts`, canvas
  `intel/{graph,geo}`, `mail-index/store.ts` — `OWNER_INTEL_SCOPE`.

**Leak guard.** `scripts/check-intel-scope.mjs` (run by the gate, same shape as
`check-public-routes.mjs`) lists every file that queries `intelNotes`,
`intelEntities` or `intelRelationships` and fails when a file is neither
calling a scope helper nor on a reviewed maintenance allow-list (cleanup,
backfill, engine stages, trust refresh, taxonomy). A new unscoped reader fails
CI rather than leaking.

**Nightly engine** (`startIntelEngine`) iterates spaces for resolve,
adjudicate, watchlist and lenses; confidence and embeddings are per-row and stay
global. Gmail rolling loops all active accounts (below).

## 3. Domains

`$lib/jkai/intel/domains.ts` (pure):

| Domain | Raw sources |
|---|---|
| Email | `email` |
| News | `news` |
| Documents | `file` |
| Chat & capture | `chat`, `web`, `pwa` |
| Research | `research`, `daydream`, `notebook` |
| Automations | `workflow` |
| Home | `home` (no writer until the HA phase) |

- `domainOf(source)`, `sourcesForDomains(domains)`; an unknown source falls into
  a visible `Other` bucket rather than vanishing.
- News "keep" (`news/actions.ts`) writes `source: 'news'`. Backfill: rows with
  `source = 'web' AND metadata ? 'newsKey'` → `'news'` (exact: every news note
  carries `newsKey`). Run via the existing `POST /api/jkai/intel/backfill`
  (`{"newsSource": true}`).
- `trust.ts` grades `news` like `web` today.
- `/api/jkai/intel/network` and `evidence-network` accept `domains=`, expanded
  to sources server-side and intersected with any `sources=`. Empty = no filter.
  Counts come from the whole scoped graph (the source-picker rule).

## 4. `/jkai/intel` UI

A **Scope** rail section at the top of the left rail (above Search):

- **Space** chips: `Mine · Household`, both on by default. With both on, nodes
  carry a space outline (reusing the cluster-outline channel's rendering, not a
  second highlight channel). A member's "Mine" is their own space.
- **Domain** chips with whole-graph counts; a domain with zero entities is shown
  disabled, not hidden (Home reads as "coming").
- The existing SourcePicker nests under its domain for fine filtering.
- State in the URL (`spaces=`, `domains=`) so it round-trips through lenses and
  links. Follows `sr-design` rail patterns; no new fonts or tokens.

## 5. Members

- `allowed_user.role text NOT NULL DEFAULT 'guest'` (`'guest' | 'member'`).
  `/admin/access` gains a role toggle; promoting creates the member's principal
  (idempotent on `external_ref`), demoting leaves their data in place.
- `$lib/auth.ts` gains `isMemberAllowedPath(pathname)` — an **exact-path /
  exact-pattern** list, never a prefix (see
  `reference_gate_bypass_catalogue_is_prefix_vs_exact`):
  - pages: `/jkai/intel`, `/jkai/intel/notes`, `/jkai/intel/notes/[id]`,
    `/jkai/intel/entities`, `/jkai/intel/entities/[id]`, `/jkai/intel/search`,
    `/jkai/intel/timeline`
  - APIs (GET only): network, evidence-network, source-facets, entity-card,
    mentions, entity + note reads, search, timeline
  - Gmail: `/api/gmail/connect`, `/api/gmail/callback` (member-owned account)
- The hook checks owner → member (`role='member'` + allowed path) → guest.
- Everything that writes or spends stays owner-only in phase 1: ingest,
  commission, merge / quality, backfill, mail triage, categories, dossiers
  editing.
- Members' `/jkai/intel` header hides the `← chat` chip and any workbench entry
  outside their allow-list.

### Member Gmail

- The connect/callback flow stamps `gmail_accounts.principal_id` with the
  signed-in principal. A member can connect only for themselves.
- A member's connect asks for **`gmail.readonly` only** (plus `openid email`).
  The owner flow keeps `gmail.modify` / `gmail.send` / `gmail.labels`; a family
  member is never asked to let the site send mail as them.
- Gmail rolling ingest iterates **all** active accounts, writing each account's
  notes into its principal's space.
- Owner surfaces that list accounts (canvas Gmail pickers, connectors, workflow
  gmail service, mail triage) filter `principal_id = 'owner'`, so no owner
  workflow can read a member's mailbox.
- Member held-thread triage is deferred; members get the default relevance
  rules.

## 6. Delivery

**PR A1 — spaces + domains, owner only.** Schema columns, explicit space on
every write, resolution guard, scoped graph snapshot, domains, news source fix,
Scope rail, and the leak guard seeded with a BASELINE of today's unscoped
readers (~100 files; 56 use raw SQL) so a new unscoped reader fails CI at once.

**PR A2 — burn-down.** Scope every baseline reader (library functions take
`scope: IntelScope = OWNER_INTEL_SCOPE`, so owner call sites do not change), the
nightly engine iterates spaces, and the guard flips to strict (baseline must be
empty).

PR B refuses to write a non-owner space while the baseline is non-empty — the
member Gmail sweep checks it in code, so the ordering is enforced, not
remembered.

**PR B — members.** `allowed_user.role`, `drive_folder_settings.space_id`, the Gmail watcher skipping non-owner accounts (it dispatches workflows and pushes chat previews), household/user principals, member
path allow-list, member Gmail, account-list filters, header tweaks.

Each PR merges, deploys and is verified live before the next starts.

## Verification

- Unit: `domainOf` / `sourcesForDomains`; `scopeForPrincipal`; filter with
  `domains` + `sources`; merge refuses cross-space pairs; mention candidates
  exclude other spaces.
- Integration: seed a note in space `u_test`; assert it never appears in owner
  network, `searchIntel`, `buildKnowledgeContext`, `fetchMentionIndex`.
- Leak guard: the gate fails on a deliberately unscoped reader (test fixture).
- Live (PR A): `/api/jkai/intel/network?domains=news` returns only news-derived
  nodes; entity / edge counts identical before and after the backfill;
  `/jkai/intel` renders with the Scope rail.
- Live (PR B): a member session gets 200 on `/api/jkai/intel/network` with none
  of the owner's entities, 403 on `/api/jkai/intel/commission` and
  `/api/jkai/intel/ingest`, redirect on `/jkai`.

## Risks

1. **Google OAuth publishing status.** Sign-in and Gmail share one OAuth
   client (`GOOGLE_CLIENT_ID`). In "Testing" a restricted-scope refresh token
   dies after 7 days. Evidence says the app is already "In production"
   (unverified): the owner's Gmail account has been connected since 2026-04-30
   and was still active with no error on 2026-09-24. Confirm on the console's
   Audience page before PR B. Stay **unverified** — under 100 users is Google's
   personal-use allowance, and verifying restricted Gmail scopes means an annual
   paid CASA assessment. Members see the "Google hasn't verified this app"
   interstitial once, at connect time.
2. `analytics/load.ts` does not filter `graph_state` (other readers do). Out of
   scope; logged.
3. Cache fan-out: one snapshot per distinct scope. With a handful of family
   members this is a handful of ~350ms builds — fine; revisit past ~20.
4. Schema push: 10 added columns in A1 (plus one in B), all non-unique with defaults — push-safe per
   the drizzle memory notes. Run `drizzle-kit push` against the local :5433 DB
   first and read the diff.
