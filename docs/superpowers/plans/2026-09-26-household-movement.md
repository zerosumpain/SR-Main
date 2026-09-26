# Household movement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Life360-style household movement on `/home/people`, fed by the SR companion app (Life360 kept as a per-person fallback), with per-person stats and arrive/leave alerts.

**Architecture:** The pilot (SR-AppleApp, Node + SQLite on `127.0.0.1:5295`) gains a household service lane that SR-Main's existing 120 s observe job pulls from into `daydream_trail`. Location code moves from `$lib/daydream` to `$lib/home/presence` so the daydream simplification cannot delete it. Crossings of labelled places become `household_event` rows, forwarded to the pilot as per-user alert queues the phone drains, plus WhatsApp for owner-flagged places.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes + Drizzle/Postgres 16 (SR-Main); Node 22 `node:http` + `node:sqlite` (pilot); SwiftUI (iOS).

**Spec:** `docs/superpowers/specs/household-movement.md` (read it first; its D1–D4 are binding).

## Global Constraints

- Both repos are PUBLIC: no place name, address, coordinate, phone number or family id in code, tests, fixtures, commits or PR bodies. Test fixtures use made-up coordinates (e.g. 51.0, -1.0).
- The household token is its own secret: `APPLE_HOUSEHOLD_TOKEN` (pilot env) == `COMPANION_HOUSEHOLD_TOKEN` (SR-Main env). Unset ⇒ the pilot endpoints 404 and SR-Main skips companion ingest silently.
- Tables keep their names (`daydream_trail`, `daydream_places`). No renames, ever (drizzle push TTY prompt exits 0 without applying).
- New SR-Main tables: read `~/.claude/projects/-home-john/memory/reference_drizzle_push_rename_prompt.md` and `reference_drizzle_push_pk_fk_ordering.md` first; add to `tablesFilter` if that file says so.
- Scoping (D2) is enforced in server load functions/endpoints, never in the page. Prod DB role bypasses RLS.
- Choosing not to share (pilot `sharing=0`) must result in NO new fixes for that person from any source.
- Never call `notifyOwner` for household alerts (it is owner-only).
- Heartbeat activity NAMES stay `daydream-observe` and `daydream-places` (DB identity; renaming orphans rows). Their files move; they no longer consult daydream's `SETTINGS_ENABLED_KEY`.
- Server before app: the pilot deploys before any TestFlight build that calls new endpoints.
- Never run destructive commands against the shared dev DB; never `reset --hard` a shared checkout; SR-Main full gate runs via `./scripts/gate-remote.sh`.
- Copy is en-GB, plain words.

---

## Part A — SR-AppleApp (pilot server + iOS). Worktree: `~/wt-apple-household`, branch `feat/household-lane`.

### Task A1: `owner` on `/api/apple/me`, alerts table

**Files:** Modify `server/store.mjs` (schema), `server/app.mjs` (`/api/apple/me`). Test: `server/test/app.test.mjs`.

**Interfaces — Produces:**
- SQLite table `alerts(user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, payload TEXT NOT NULL, created TEXT NOT NULL, acked TEXT, PRIMARY KEY(user_id,id))` + index `alerts_user_pending ON alerts(user_id, acked, created)`.
- `GET /api/apple/me` response gains `owner: boolean` (true iff the signed-in user's email equals `APPLE_SERVICE_OWNER`, case-insensitive; false when unset).

- [ ] Test: `/me` for the owner returns `owner:true`; for a second family user `owner:false`; with `APPLE_SERVICE_OWNER` unset, `owner:false`.
- [ ] Run `node --test server/test/app.test.mjs` → FAIL; implement; → PASS; commit.

### Task A2: `GET /api/apple/household` (household lane)

**Files:** Modify `server/app.mjs` (new gate beside `serviceOwnerId`, reading `APPLE_HOUSEHOLD_TOKEN`), `server/main.mjs` (pass env through the same way `serviceToken` is passed). Test: `server/test/app.test.mjs`.

**Interfaces — Produces:** `GET /api/apple/household?since=<cursor>&limit=<n>` with `Authorization: Bearer <APPLE_HOUSEHOLD_TOKEN>`.
- Token unset ⇒ 404. Wrong token (including the SR-Health service token) ⇒ 401. Unknown query params ⇒ 400.
- Family = the `family` of the `APPLE_SERVICE_OWNER` user. No owner row ⇒ `{cursor: since ?? '', users: [], fixes: [], more: false}`.
- `cursor` is an opaque string `"<received ISO>|<user_id>|<location id>"`; fixes are ordered by `(received, user_id, id)` strictly after the cursor. `limit` default 2000, max 5000.
- Response: `{cursor, more, users:[{email, name, sharing:boolean}], fixes:[{email, id, recorded, lat, lon, accuracy, speed, moving}]}` — `users` lists every family member; `fixes` only from users with `sharing=1` NOW.
- Numbers rounded as `/api/apple/track` does (6 dp lat/lon, 1 dp accuracy, 2 dp speed).

- [ ] Tests: 404 unset; 401 with SR-Health token; paging across two pages returns every fix exactly once; a user with sharing off appears in `users` with `sharing:false` and contributes no fixes; a user in another family never appears.
- [ ] FAIL → implement → PASS → commit.

### Task A3: household events in, alerts out

**Files:** Modify `server/app.mjs`. Test: `server/test/app.test.mjs`.

**Interfaces — Produces:**
- `POST /api/apple/household/events` (household token). Body `{events:[{id, recipients:[email], title, body, at}]}` (≤200 events, `id` ≤100 chars, `title` ≤120, `body` ≤300, `at` ISO). For each recipient that is a user in the owner's family, `INSERT OR IGNORE INTO alerts` with `payload = JSON {id,title,body,at}`. Response `{accepted:<rows inserted>}`. Unknown recipient emails are skipped, not errors.
- `GET /api/apple/alerts` (device or browser auth, own user only): up to 50 unacked alerts, oldest first: `{alerts:[{id,title,body,at}]}`.
- `POST /api/apple/alerts/ack` body `{ids:[string]}` (≤100): sets `acked` for the caller's rows only. Response `{acked:n}`.
- Prune: alerts older than 7 days are deleted on each events POST.
- `DELETE /api/apple/data` also deletes the caller's alerts.

- [ ] Tests: idempotent on repeated id; a recipient only sees their own alerts; ack of another user's id acks nothing; 7-day prune; data delete removes alerts.
- [ ] FAIL → implement → PASS → commit.

### Task A4: iOS — consent, member defaults, alert drain

**Files:** `ios/SRAppleApp/Models.swift` (decode `owner`), `Companion.swift` (fetch/ack alerts), `HealthCollector.swift` or the Health settings store (default group toggles off when `owner == false`, only when the user has never set them), the Location settings/onboarding screen (first-run question "Share your location with the household?", default off, writes `PUT /api/apple/sharing`), `SRAppleApp.swift` `drain(into:companion:)` (also drain `/api/apple/alerts` → local notifications, then ack). Tests in the existing test target where a precedent exists (look at how `drainPending` / `AlertStore` are tested).

**Interfaces — Consumes:** A1 `owner`, A3 alert endpoints.

- [ ] A notification's text is the server's `title`/`body` verbatim (the server writes the crossing time into the body, e.g. "arrived 17:52"). Posted with the alert `id` as identifier so a repeat drain cannot double-post.
- [ ] Ack only after the local notification request is added successfully.
- [ ] Owner's existing toggles are untouched (migration only applies to users with no stored choice and `owner == false`).
- [ ] Build via the repo's CI (`gh workflow run` as precedent in `.github/workflows`); commit.

### Task A5: ship the pilot

- [ ] PR, CI green, merge. Deploy the pilot the way the repo's deploy docs say (hand-deployed release, see `deploy/` and README). Set `APPLE_HOUSEHOLD_TOKEN` in `/opt/sr-appleapp/pilot.env` (generate with `openssl rand -base64 32`), keep a dated copy of the env beside it first.
- [ ] Verify live: `curl -s -H "Authorization: Bearer $T" http://127.0.0.1:5295/api/apple/household?limit=5` on the VPS returns the owner's recent fixes; with the SR-Health token → 401.
- [ ] Dispatch TestFlight only after the server is live.

---

## Part B — SR-Main. Worktree: `~/.worktrees-srmain-household`, branch `spec/household-movement` (rename to `feat/household-movement` before PR).

### Task B1: move location into `$lib/home/presence`

**Files:**
- Move (git mv): `src/lib/daydream/{observe,cluster,journeys,backfill}.ts` + their tests → `src/lib/home/presence/`. Move `places.ts` → `src/lib/home/presence/places.ts` EXCEPT `reconcileNamedPlaceThoughts` (daydream-thought coupling), which moves to `src/lib/daydream/place-thoughts.ts`.
- Leave one-line re-export shims at every old path (`export * from '$lib/home/presence/observe';`) so daydream code and routes compile unchanged.
- Location constants/types used by the moved files (trail sources, mode, cadence, radius, retention, `FAMILY_SUBJECTS`, `SubjectEntity`, `LOCAL_TZ`) move to `src/lib/home/presence/types.ts`; `src/lib/daydream/types.ts` re-exports them.
- `loadFamily()` members half → `src/lib/home/presence/household.ts` as `loadHousehold()` returning `{members}`; `ledger.ts#loadFamily` becomes `loadHousehold()` + its daydream `detail`, unchanged in shape.
- Activities: `src/lib/heartbeat/activities/daydream-{observe,places}.ts` → `home-observe.ts`, `home-places.ts`; exported handler NAMES unchanged; remove the `SETTINGS_ENABLED_KEY` skip; update `registry.ts` imports.

**Interfaces — Produces:** `$lib/home/presence/{observe,places,cluster,journeys,backfill,types,household}` with identical exported signatures to today.

- [ ] Run the moved unit tests + `npx svelte-check` (via local-qa conventions) → green. Grep proves no import of the old paths outside shims is required. Commit "presence: location leaves daydream".

### Task B2: `household_member` + place alert flags

**Files:** `src/lib/db/schema.ts` (new table; two columns on `daydream_places`), `src/lib/home/presence/members.ts`, test `members.test.ts`.

**Interfaces — Produces:**
- `householdMember` table: `subject text pk`, `email text unique null` (lower-cased), `displayName text not null`, `source text not null default 'life360'` (`'life360'|'companion'|'none'`), `haPersonEntity text null`, `whatsapp text null`, `alerts jsonb not null default '{}'` (shape `{follow?: string[] /* subjects; absent = everyone */, whatsapp?: boolean}`), `createdAt`, `updatedAt`.
- `daydream_places` gains `alerts boolean not null default false`, `whatsapp_alerts boolean not null default false`.
- `members.ts`: `listMembers(): Promise<HouseholdMember[]>` (seeds from `FAMILY_SUBJECTS` with `source='life360'`, `haPersonEntity=entity`, `displayName` = capitalised subject, via `onConflictDoNothing`, when the table is empty); `memberByEmail(email): Promise<HouseholdMember|null>`; `updateMember(subject, patch)`; pure `followers(members, moverSubject): HouseholdMember[]` (everyone except the mover whose `alerts.follow` is absent or includes the mover).
- [ ] Pure tests for `followers`; observe activity now builds its HA subject list from `listMembers()` where `source==='life360'`. Commit.

### Task B3: companion ingest

**Files:** `src/lib/home/presence/companion.ts` (+ test), `types.ts` (`TRAIL_SOURCES` gains `'companion'`), `home-observe.ts`.

**Interfaces:**
- Consumes A2's response shape.
- Produces `fetchHousehold(since: string, fetchImpl = fetch): Promise<HouseholdPage>`; `COMPANION_URL` default `http://127.0.0.1:5295`; token from `env.COMPANION_HOUSEHOLD_TOKEN` (unset ⇒ returns null, caller skips). Cursor stored with `setSetting('home.presence.companionCursor', cursor)`.
- `home-observe` run: (1) life360 subjects polled as today; (2) companion subjects: page through `fetchHousehold` until `more=false` (cap 10 pages/run); map `email → subject` via `members`; write each fix with `recordFix({lat,lon,accuracyM,speedKmh: speed*3.6, ts: recorded, ...}, 'companion', subject)` — check `recordFix`'s actual input type in observe.ts and adapt; fixes for emails not mapped to a `companion`-source member are dropped (counted in details). (3) `source='none'` subjects: nothing.
- A companion-source member with `sharing:false` in the response is surfaced as `notSharing` on `loadHousehold()` members (store the latest users list in a setting `home.presence.companionUsers`).
- [ ] Tests (mock fetch): paging, cursor persisted only after the page's fixes are written, unmapped email dropped, unset token ⇒ no fetch. Commit.

### Task B4: `household` role + scoped `/home/people`

**Files:** `src/lib/auth.ts` (`HOUSEHOLD_ROUTES`, `isHouseholdAllowedPath`), `src/hooks.server.ts` (allow household role on those routes, as member routes are allowed), `src/lib/server/access.ts` if role parsing lives there, `src/routes/home/people/+page.server.ts`, `src/routes/home/people/[subject]/+page.server.ts` (new, used by B5), tests beside auth.

**Interfaces:** `HOUSEHOLD_ROUTES = {'/home/people': ['GET'], '/home/people/[subject]': ['GET']}`. `viewerOf(locals): {kind:'owner'} | {kind:'household', subject} | null`. `/home/people` load: everyone gets `members` live cards (sharing-respecting); the page receives journeys/stats only for the viewer's own subject (owner: all). `/home/people/[subject]`: 403 for a household viewer asking for another subject.
- [ ] Tests run the real load functions with a faked `locals`: a household viewer's payload contains no other subject's journeys; owner sees all. Commit.

### Task B5: movement stats + person page

**Files:** `src/lib/home/presence/stats.ts` (+ `stats.test.ts`), `src/routes/home/people/[subject]/+page.{server.ts,svelte}`, link from each person card on `/home/people`.

**Interfaces — Produces:** `movementStats(journeys: Journey[], visits: {placeId, label|null, from, to}[], opts: {days: number, now: Date}): MovementStats` where
`MovementStats = { byMode: Record<'foot'|'car'|'rail'|'other', {count, metres, seconds}>, walkingPace: {medianMps, p75Mps, n, weekly: {weekStart: string, medianMps: number, n: number}[]} | null, commonTrips: {fromLabel, toLabel, count, usualDeparture: 'HH:MM', medianSeconds, mode}[], timeOut: {date, minutesOut, firstOut: 'HH:MM'|null, lastIn: 'HH:MM'|null}[] }`.
Rules: foot = journey mode walking/active with avg speed ≥ 0.9 m/s and ≤ 2.5 m/s; pace uses foot journeys ≥ 500 m; trips need both ends labelled and ≥ 3 occurrences; mode map from `journeys.ts` modes (read `MovementMode`).
- [ ] Pure tests for each rule. Page uses `HomeFrame` + `HealthShell` patterns (read `sr-design` skill in repo and `svelte5-pitfalls`), figures + one chart per concern, "inferred from speed" note. Commit.

### Task B6: crossings, events, alerts, WhatsApp, panels

**Files:** `src/lib/home/presence/crossings.ts` (+ test), schema `household_event`, `src/lib/home/presence/alerts.ts` (+ test), wire into `home-observe.ts`, `src/routes/home/people/places/+page.{server.ts,svelte}` (owner: rename, radius, `alerts`, `whatsapp_alerts` toggles), `src/routes/home/people/settings/+page.{server.ts,svelte}` (owner: members table editing incl. source, email, WhatsApp number, follow list).

**Interfaces:**
- `household_event`: `id text pk` (`${subject}:${placeId}:${kind}:${epochSeconds}`), `subject`, `placeId`, `kind` ('arrive'|'leave'), `at timestamptz`, `forwardedAt timestamptz null`, `whatsappSent jsonb not null default '[]'` (subjects sent to), `createdAt`.
- `detectCrossings(prev: {inside: Set<placeId>}, fix: {lat, lon, accuracyM, ts}, places: {id, lat, lon, radiusM}[]): {events: {placeId, kind}[], inside: Set<placeId>}` — arrive when distance ≤ radius AND accuracy < radius; leave when distance > radius + 50. Per-subject `inside` state persisted in a setting `home.presence.inside.<subject>`. Only places with `alerts=true` or the home place.
- Dedupe: skip if the same (subject, placeId, kind) exists within 10 min.
- `deliver(events)`: POST to pilot `/api/apple/household/events` with recipients = `followers()` emails (companion members only), title `"<Name> arrived at <Label>"`/`"left"`, body `"at HH:MM"` (Europe/London); set `forwardedAt`. For `whatsapp_alerts` places, WhatsApp `sendMessage(number, text)` to followers with `alerts.whatsapp===true` and a number, at most one message per recipient per (subject, place) per 30 min; record in `whatsappSent`. Find the WhatsApp service accessor the way `followup-queue.ts` does.
- [ ] Tests: jitter at edge produces one arrive, one leave; poor accuracy suppresses arrive; dedupe; mover never a recipient; WhatsApp only for flagged places. Commit.

### Task B7: ship SR-Main

- [ ] `./scripts/gate-remote.sh` green; PR; CI green; merge (auto-deploys). Set `COMPANION_HOUSEHOLD_TOKEN` in the VPS `.env` deliberately (`sudo chattr -i` → edit → `+i`, dated copy first).
- [ ] Live verify: `daydream_trail` gets `source='companion'` rows for john within 2 min of a phone fix; `/home/people` renders; `/home/people/john` shows 25 Sep drives as car journeys; walking out of the home radius yields a `household_event` and an alert row in the pilot for a follower.
- [ ] Owner flips john's `source` to `companion` in settings.

## Self-review notes

Spec §1→B1, §2→B2/B3, §3→A2/B3, §4→B4, §5→B5, §6→A3/A4/B6, §7→A1/A4, §8→A5/B7 + final report. The plan specifies interfaces and test cases; implementers write the code against the precedents named in each task (Decision Log: full code in-plan was judged slower than precedent-led implementation for a two-repo build of this size).
