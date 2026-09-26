# Access groups: per-user permissions by area

**Brief (John, 2026-09-26):** add new users to the site with access to different sets of
activities, configurable to some degree, built from groups of permissions:

- **Super Admin**: full access to everything, locked to John (one user).
- **Family Circle**: see your own and family members' locations on a map.
- **Family Admin**: see your own and your kids' location history.
- **viewer self / viewer all / admin all** for each of Home, News, Research, Drive and jkai
  (per jkai feature): access only your own material, all the material, or contribute to it.

**Decisions (John, 2026-09-26, one batched round):**

| # | Question | Answer |
|---|---|---|
| Q1 | What the three levels mean | **self** = full use of your own space (create, read, edit your own). **all** = self + read everyone's. **admin** = all + edit/delete/contribute to everyone's. |
| Q2 | Does "all" include John's private material? | **No.** "All" means other users' material plus anything shared to the household. John's items stay his unless he moves them into the shared space. |
| Q3 | jkai granularity | **Per feature, safe subset**: chat, notes, intel, knowledge. Canvas, builds/develop, agents, codegraph, settings and trace stay Super Admin only (they run code, hold credentials or spend unattended). |
| Q4 | How configurable | **Permissions fixed in code; groups editable at /admin/access; a user gets groups plus optional one-off grants.** |

Then: "crack on autonomously". Everything else is in the Decision Log.

This spec is in a public repo: it names no person's email, address or number.

## What is there today

- **Owners** are the `AUTH_ALLOWED_EMAILS` env list, checked without the database so a DB
  outage cannot lock John out (`$lib/server/access`). Production holds exactly one address.
- **`allowed_user`** is the sign-in allow-list: `role` is `'guest'` (signs in, sees public
  pages) or `'member'` (their own intel space at `/jkai/intel`, read-only Gmail). Production
  holds no rows.
- **The hook is deny-by-default.** Every authed page and API is owner-only unless
  `isGuestAllowedPath` (empty) or `memberMayReach` opens it. `memberMayReach` checks
  `MEMBER_ROUTES` in `$lib/auth.ts`: SvelteKit **route ids** plus verbs, never pathnames
  (`notes/[id]` as a path pattern also matches `notes/new`).
- **`viewerOf(event)`** (`$lib/server/viewer`) answers owner / member / guest / anonymous once
  per request. A member is an `allowed_user` row with role `member` plus an
  `activity_principals` row (`u_…`) — their **space**.
- **Intel is the only area with per-user ownership**: `space_id` on every intel row,
  `resolveRequestScope` as the one seam, a structural test (`route-scope.test`) that every
  intel route calls it, and an integration test (`members.integration.test`) that a member
  session gets no owner row back from any route it can reach.
- **Production's DB role is a superuser**, so Postgres RLS cannot scope anything: scoping
  lives in code (`reference_prod_db_role_is_superuser_no_rls`).
- **Household movement** (spec `household-movement.md`, shipping in parallel) adds a
  `household` role, `HOUSEHOLD_ROUTES` for `/home/people`, `viewerOf` kind `household`, and
  `scopeHousehold()`. It lands first; this work converts it (see P2).

## Design

### 1. The model

**Levels** are ordered: `self` < `all` < `admin`. Holding a level grants everything below it.

**Areas** (the fixed catalogue, `$lib/access/catalogue.ts`, pure, importable by the client):

| Area | self | all | admin |
|---|---|---|---|
| `news` | read the desk; own favourites and reads | = self (nothing of anyone else's to read) | = self (the feed list is code, not rows) |
| `research` | run and read own research | + read everyone's (not John's) | + edit/delete everyone's (not John's) |
| `drive` | own files | + read everyone's + household files | + edit those |
| `home` | the `/home` dashboard, devices, echoes, voice (read) | = self (none of it is per-person) | = self (no writes exist) |
| `jkai.chat` | own threads, restricted tools | + read everyone's threads | + manage them |
| `jkai.notes` | own notebook | + read everyone's | + edit everyone's |
| `jkai.intel` | own space + household (today's member) | + read every member's space | + triage everyone's held mail |
| `jkai.knowledge` | recall over what they may read | follows the other grants | = all |

Plus two special permissions with no levels: **`family:circle`** and **`family:admin`**.

A permission is written `area:level` (`research:all`, `jkai.notes:self`, `family:circle`).
Unknown strings — a permission retired from code but still in a row — are dropped on read,
so the database can never grant something the code does not define.

**Super Admin** is not a permission. It is the owner env list, checked first and never
offered in any UI; the owner satisfies every check.

**Groups** live in a new table and are editable at `/admin/access`:

```
access_group (id text pk, label text, description text, grants text[], built_in bool,
              created_at, updated_at)
```

Two built-ins are seeded idempotently on first read: **Family Circle** (`family:circle`)
and **Family Admin** (`family:circle`, `family:admin`). A built-in group's grants and label
are editable; it cannot be deleted.

**A user** is an `allowed_user` row with two new columns, `groups text[]` and
`grants text[]` (one-off extras). Their **effective permissions** are the union of their
groups' grants and their extras, filtered through the catalogue. A legacy `role='member'`
row counts as holding `jkai.intel:self`, so nothing changes for anyone mid-deploy.

A user with **any** effective permission gets an `activity_principals` row (`u_…`), created
on first grant and kept for ever (it is what their material hangs off; demoting is not
deleting). A user with none is a guest.

### 2. Who is asking: `viewerOf`

The `member` kind gains the permissions:

```ts
| { kind: 'member'; principalId: string; email: string; grants: ReadonlySet<Permission> }
```

Resolved in one query per request (allowed_user ⋈ principal, then the named groups), cached
on `locals` exactly as today. Guests stay `guest`. The owner is still decided from env with no
database read.

### 3. Reaching a route: the hook

`memberMayReach` becomes `grantMayReach`. The catalogue maps each **route id + verb** to the
permission it needs (`requiredFor(routeId, method)`), shaped exactly like `MEMBER_ROUTES`
today — which moves into the catalogue as `jkai.intel:self`. The hook opens a route when
the viewer is a member holding a permission at or above the one required. A route not in
the catalogue stays owner-only: new code is closed until someone lists it.

### 4. Seeing rows: `scopeFor`

Reaching a route decides nothing about which rows come back. Each area reads through one seam,
`$lib/server/access/scope.ts`:

```ts
areaAccess(viewer, area) → { level: 'owner' | Level; own: string }   // 403 if none
readable(column, access)  → SQL   // owner: true · self: col IN (own,'household') · all/admin: col <> 'owner'
writable(column, access)  → SQL   // owner: true · self/all: col = own · admin: col <> 'owner'
ownerOf(access)           → string // the principal a new row is written with
```

The principal column is called `principal_id` everywhere it is new, defaults to `'owner'`
(so every existing row stays John's without a backfill), and holds `'owner'`,
`'household'` or a `u_…`. Intel keeps `space_id` and its own seam, which gains `all`.

Household-shared rows are readable at every level: shared means shared.

### 5. Proof, per area

Every area that opens copies the intel proof:

- **Structural:** every route file the catalogue opens for that area calls `areaAccess`
  (the `route-scope.test` shape).
- **Integration:** a real `allowed_user` row with that area's `self` grant, the real
  seam, every route in the catalogue for the area; seeded owner rows carry a secret word
  and no response may contain it. Proven red first by handing the viewer the owner scope.

### 6. `/admin/access`

The page keeps its shell (`PageWrap`, `nm-*` sections) and becomes three sections:

- **Super Admin** (read-only, from env) — was "Owners".
- **People**: add by email (as today); each row shows group chips and extra grants, and opens
  an editor: tick groups, and a grid of areas × none/self/all/admin plus the two family
  checkboxes. Areas whose routes have not opened yet are shown disabled, labelled *not yet
  open*, so a grant never silently does nothing.
- **Groups**: each group with its grants; edit, create, delete (non-built-in).

APIs, all owner-only by the existing hook:
- `PATCH /api/admin/access {email, groups, grants}` (replaces `{role}`).
- `/api/admin/access/groups`: GET, POST, PATCH, DELETE.

Losing every `jkai.intel` grant disables the user's Gmail, as demotion does today.

### 7. Navigation

`site-nav.ts` knows only owner / not owner. Once an area opens, a user holding it needs the
section in the top nav. `NavItem`/`NavSection` gain an optional `requires: Area` (in place of
`ownerOnly` for the grantable sections), and the renderers take the viewer's area list from the
root layout. `site-nav.ts` is vendored byte-for-byte into SR-Drive and SR-Health, so the phase
that changes it also records the hash and opens the peer PRs. Until then a user reaches an
open area by link.

## Phases

| Phase | Ships | Opens |
|---|---|---|
| **P1** | catalogue, `access_group`, `groups`/`grants` columns, `viewerOf` grants, catalogue gate in the hook, intel `all`/`admin`, `/admin/access` UI, member → `jkai.intel:self`, household role → `family:circle` | intel (as today, plus `all`), `/home/people` for Family Circle |
| **P2** | Family Admin: guardian→child link, own + kids' journeys/history; circle map of live positions | `/home/people/[subject]` for wards, the map |
| **P3** | News + Research: `research_session.principal_id`, both research route trees scoped, run cap; news reads keyed on the viewer | `/news`, `/research` |
| **P4** | Home (dashboard minus people unless circle), jkai notes + knowledge scoping | `/home`, `/jkai/notes`, recall |
| **P5** | jkai chat: `principal_id` on threads, a fixed safe tool list, member scope in context | `/jkai` chat |
| **P6** | Drive: `workflow_files.principal_id`, SR-Drive's hook reads grants from the shared DB, listings filtered; nav kit to peers | `/drive` |

Each phase is its own PR, merged and verified live before the next begins.

The `scopeFor` seam (§4) ships with P3, its first consumer: shipped alone in P1 it would be
code with no caller.

## Area notes (from the code, 2026-09-26)

### News (P3)
- Favourites, reads and last-visit are already keyed per user (`newsOwnerKey` = login email).
- The desk's **correlations** read John's research, intel and memory (`correlate.server.ts`),
  and **stats/kept** read owner intel. A non-owner desk gets neither: correlations off,
  kept/stats computed in their intel scope or omitted.
- Actions: `favourite` is theirs; `graph` needs `jkai.intel` and writes into their own space;
  `note` needs `jkai.notes`; `research` needs `research:self` and goes through the run cap.
- The native (phone) news lane is owner-only and stays so.

### Research (P3)
- One owned root, `research_session`; every child hangs off `session_id` except
  `entity_mention` (via fact/entity). A `principal_id` on the session covers children by join.
- **Two route trees**: `/research` + `/api/research/*`, and the older `/api/deepdive/*`
  (~20 handlers: delete cascade, share, chat, synthesis, exports). Both are scoped.
  `/api/research/source/[id]` reads by source id alone and must check the session.
- `searchResearch`, the site tools, knowledge search, daydream, briefing and news
  correlation read sessions without a viewer. They keep the owner default and filter
  `principal_id = 'owner'`… except where a viewer is present (P4 knowledge).
- **No cash cap exists** (only wall-clock budgets per depth). Non-owner runs are capped:
  depth at most `brief`, and 5 starts per rolling 24 h per principal (setting
  `access.research.dailyRuns`). Resume counts as a start.
- The resume sweep adopts runs with no user attached; it reads the row, so a run keeps its
  `principal_id` whoever resumes it.

### Home (P4) and Family (P2)
- `/home` pages are GET-only loads (no writes). `/home` itself shows `loadFamily()` members;
  a `home` holder without `family:circle` gets the dashboard without the people card.
- The household branch's `scopeHousehold()` already gives: own card full, others live status
  only, not-sharing cards emptied, owner everything. **Family Circle = that**, keyed on
  `family:circle` rather than a role.
- **Family Admin** adds `household_member.guardian_of text[]` (subjects), owner-edited. A
  guardian's own + wards' cards are full and their `/home/people/[subject]` opens.
- **The map**: there is no map in SR-Main. The `/apple-app` map (SR-AppleApp) is a hand-built
  raster-tile map (no GL) that keeps a strict CSP and fetches `/api/maps/config`. The circle map
  follows it: a small Svelte port of the raster approach, live positions only, no trails.

### jkai notes (P4)
- The notebook is `daydream_notebook` (+ `_actions`, `_audio`), served by `/jkai/notes` and
  `/api/daydream/notes*` (a POST that dispatches on `action`). No owner column.
- `principal_id` on `daydream_notebook`; actions and audio follow their note.
- `weave` extracts into intel with `spaceId: OWNER_SPACE` hard-wired: for a member it writes
  into their own space, and only if they hold `jkai.intel`. `review_now` plans actions that
  call `research_start`: refused for a non-owner (the research cap applies to research only
  through `/research`). Audio transcription is allowed (local whisper first).
- The notebook heartbeat, ponder and news brief read notes unattended: they filter
  `principal_id = 'owner'`.

### jkai knowledge (P4)
- `/api/jkai/knowledge/search` (POST) → `searchKnowledge`, six sources, none scoped:
  intel (defaults to owner scope), files (/drive), research, memory (`jkai_memories`, John's),
  datastore (actor hard-coded `'owner'`), activity (owner principal).
- A non-owner's recall passes the request's scopes: intel through `resolveRequestScope`,
  research through `readable()`, notes through `readable()`, files only with `drive` (P6).
  Memory, datastore and activity are John's and are never searched for anyone else.
- `/jkai/intel/search` (the page) opens with `jkai.knowledge`.

### jkai chat (P5) — the riskiest phase
- Threads (`jkai_conversations`), messages (`orchestrator_chats`), traces and attachments
  have no owner. `principal_id` goes on `jkai_conversations`; the rest follow the thread.
- **Tools cannot tell who is calling** (`ToolExecContext` has no principal), tier 3 can pull
  *any* registered tool by name, and the model can `activate_toolset` anything. A non-owner
  turn therefore runs on a **closed list**, enforced in the executor, not the prompt:
  `discovery`, `visualise`, `web`/`research_web_search`, `news`, and — with the matching
  grant — their own notes, research (capped) and intel (their scope). Everything that reads
  John's data, sends, schedules, spends or runs code is refused.
- **Context**: no memory section (it is John's), no saved integrations, no graph section
  unless `jkai.intel`, and a member persona prompt instead of `01-soul`/`04-context`
  (which describe John).
- **After the turn**: no intel extraction into John's space; the 30-minute memory review
  skips non-owner threads; uploads do not mirror into John's /drive.
- The chat job APIs list and cancel **all** jobs when no id is given: a member only ever
  sees and cancels their own.
- Only the web path carries a viewer; WhatsApp, follow-ups, delegation and scheduled turns
  stay owner-only.
- Cap: 50 turns per rolling 24 h per principal (setting `access.chat.dailyTurns`).

### Drive (P6)
- SR-Drive's hook refuses every non-owner; route files do no auth. It shares Main's database and
  can read `allowed_user` (its trimmed schema copy needs `groups`, `grants`, `access_group`,
  `activity_principals`).
- `workflow_files` has no owner column (`uploaded_by` is an email also used for agent tags).
  Folders are name prefixes. Once the hook admits a non-owner, **every listing returns every
  file**, so filtering has to be in Drive's data layer.
- The gateway signs `{aud, email, method, path}` and has no DB access by design: grants are
  looked up by the app from the verified email, not carried in the assertion.
- `/dav` is still Main's, Basic-auth against `webdav_credentials`: owner-only, stays so.

## Not in scope

Postgres RLS (the prod role is a superuser); members editing places; granting any of the
Super-Admin-only jkai features; per-user model choice; a cash budget per user.

## Decision Log (autonomous run, 2026-09-26)

| Fork | Chosen | Why | Reversible? |
|---|---|---|---|
| Where permissions live | Catalogue in code; groups + grants in the DB | John's Q4; a permission in the DB with no code behind it would be a grant that does nothing or an unchecked door | Yes |
| Store user grants as join tables or arrays | `text[]` on `allowed_user` + `access_group.grants text[]` | A handful of users; one row read per request; no rename or `.unique()` push traps | Yes |
| Super Admin | Stays the env owner list, never in the UI | Can't be locked out by a DB outage; prod holds one address, as briefed | Yes |
| What "self" sees of household-shared rows | Readable at every level | Shared means shared; matches intel's member scope today | Yes |
| Family Admin implies Family Circle | Yes (built-in group holds both) | A parent who sees their kids' history and not the family's live status is not a real case | Yes, edit the group |
| Areas with no per-person data (news, home) | `self` = `all` = `admin` in effect | Nothing of anyone else's to read and nothing to administer; the levels stay for a later feature | Yes |
| Daydreams in the jkai subset | Left out | Being cut from 67k to ~10k lines; wiring grants into code about to be deleted is waste | Yes |
| £1/day spend cap | Replaced by a run cap (depth ≤ brief, 5/day) for research; chat's cap decided in P5 | No cash-cap mechanism exists and Codex prices as null (quota, not cash); a run count is enforceable today | Yes |
| Household role | Household shipped first (#973); P1 converted it to `family:circle` on rebase | Agreed with the household session; avoids two PRs rewriting the same hook | n/a |
| `householdSubjectFor` | Identity only (a `household_member` row by email); permission is `family:circle` in `peopleViewerOf` | One source for "may look"; a row is who you are, a grant is what you may do | Yes |
| Intel `all` and writes | `all` reads every member's space, writes only its own (`resolveRequestScope(event, 'write')`); `admin` writes across | John's Q1: all = read everyone's, admin = edit everyone's. Mail triage was the one member-reachable write | Yes |
| Group storage type | jsonb `string[]`, not Postgres `text[]` | The house style (`tags`, `enabled_toolsets`); SR-Drive's trimmed schema copies it as-is | Yes |
| Legacy `role` column | Kept and honoured (`member` → intel self, `household` → circle); reset to `guest` on first save at /admin/access | No data migration needed on deploy; nobody loses access mid-deploy | Yes |
| `scopeFor` seam timing | Ships in P3, not P1 | No consumer in P1; dead code on arrival | n/a |
| Grants that are not open yet | Shown disabled in the UI | A tickable grant that opens nothing is a silent lie | Yes |
| Grants in the gateway assertion for Drive | No: Drive looks them up by email | The gateway has no DB access by design, and a JWT claim would be stale until the session refreshed | Yes |
| Research cap unit | A ledger (`access_usage`) of metered acts — start, explore, resume, regenerate — taken under a per-principal advisory lock | Counting runs let a member delete runs to refund slots, and parallel requests all read "0 used" (P3 review) | Yes |
| Member explore depth | `brief`, with that tier's budget | Explore children were implicitly `investigation`, which the cap forbids; brief keeps explore usable | Yes |
| Research the owner's own stores | `to-drive`, `to-intel` stay owner-only; a member's run never auto-commits into owner intel (`fromIntel` stripped, worker checks `principalId`) | Both write into John's stores | Yes |
| Closed-area grants | Stored but never held (`isOpenPermission` in `effectivePermissions`) | The API accepts any valid string; a capability check (news "note") must not find a door the catalogue has not opened | Yes |
| Home levels | `self` = the house (dashboard, devices); `all` = + Echoes and the voice log | Both are other people's words, children's included — not a person's own material (Echoes moved up in the P4 review) | Yes |
| Notebook readers | Every store reader defaults to the owner's notes; routes pass the viewer's scope | Ponder, think, steer and the review/weave heartbeat read on John's behalf and must never pick up a member's notebook | Yes |
| Review and weave for members | Owner only | Both spend unattended-style and weave writes into John's intel space | Yes |
| Recall for members | Their intel scope + readable research only; never files, memory, datastore, activity | Those four are John's alone; Drive opens in P6 | Yes |
| Recall page | Stays in the intel workbench; give intel with recall | Moving it out of the intel layout is a redesign, not a permission | Yes |
| Member chat tools | A closed list (web search, fetch_url, news search, charts/tables/diagrams, evidence_read), enforced in the executor AND in `runSingleToolCall` | Filtering the offered tools alone leaves meta tools and model-invented names; the check sits where a call is run | Yes |
| Member chat caps | 50 turns/day, 30 uploads/day, 30 new threads/day, 2 turns at once, on the `access_usage` ledger | Same mechanism as research; Codex is quota, not cash, so a count is the cap that can be enforced | Yes |
| Owner threads in background jobs | Every background reader filters through `$lib/jkai/owner-threads` | Gmail previews, check-ins, memory review and briefings would otherwise post into or read a member's thread | Yes |
| Attachment serving | Raster images, audio, video and PDF inline; everything else downloads under `sandbox` CSP | A member's HTML or SVG upload served inline on the site origin is a stored XSS against the owner (P5 review, high) | Yes |
| `all` in chat | Reads other members' threads; posts only into your own | A turn runs as the thread's principal; posting into someone else's thread would act as them | Yes |
| Member files in Drive | Stored under `members/<principal>/`, shown to the member without the prefix | `workflow_files.name` is globally unique and the owner's tools find files by name; a prefix keeps both, where a composite index would ripple through every reader | Yes, rename rows |
| Owner's view of members' files | Not in the owner's Drive yet (404 like anyone else) | The owner's drive reads exactly as before; a Members view is a feature of its own | Yes |
| Member Drive extras | No shares, RAG index, conversion or intel extraction | Each reaches the owner's stores or public links; the upload/list/rename/delete core is what the brief needs | Yes |
| Drive quota | 2 GB per principal (`DRIVE_MEMBER_QUOTA_BYTES`), checked before the insert, not atomically | Parallel uploads overshoot by at most one file each; a lock per upload is not worth it at this size | Yes |
| Made-up folder owners | An upload names a real principal (own, household, or an existing user principal) or is refused | An admin-level member could otherwise mint rows under nobody, each with a fresh quota | Yes |
| Drive rollout | Main A → Drive A (dormant lane) → Drive B (vendored catalogue, open) → Main B (open + nav) | Each step is harmless alone: nothing a member can reach changes until the last two | n/a |
