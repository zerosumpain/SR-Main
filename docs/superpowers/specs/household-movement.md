# Household movement on /home

**Brief (John, 2026-09-26):** roll the SR companion app out to the family, so we can
keep track of each other and be told about each other's movements, a bit like
Life360. It belongs on `/home`, which is less sensitive to share with the household
than `/health`. Collate stats implied by the movements too: walking speed, common
trips by person, etc.

**Decisions (John, 2026-09-26):**

| # | Question | Answer |
|---|---|---|
| D1 | Rollout vs Life360 | Side by side: a person on the app is tracked from it, anyone else stays on Life360. **At onboarding each person chooses whether the app tracks them.** |
| D2 | Who sees what | Live position and arrivals: everyone sees everyone. Past journeys and stats: each person sees their own; the owner sees all. |
| D3 | Alerts | In the app, always. WhatsApp too, but **only for certain defined places**. |
| D4 | Members' health data | Their choice: off by default, each person can turn it on. Stored, shown nowhere yet. |

This spec is in a public repo: it names no place, address, number or coordinate.

## What is there today

- `/home/people` reads `loadFamily()` (`$lib/daydream/ledger.ts`) off `daydream_trail`:
  five subjects, Life360 via Home Assistant `person.*`, polled every 120 s by the
  heartbeat activity `daydream-observe`, 90-day retention. Places are
  `daydream_places`, inferred clusters with a label once confirmed (220 on prod, 34
  labelled). No map and no alerts; `/home` is owner-only.
- **The trail stopped being written on 2026-09-25 at 20:19 UTC.** Daydream
  simplification P3 paused `observe` and `places`, not knowing `/home/people` had
  become their only reader. P4 then deletes daydream code, and with it the
  page's data source. So location has to leave daydream whatever else happens.
- The companion pilot (SR-AppleApp, Node + SQLite, `127.0.0.1:5295` on the VPS) has
  `users(email, name, family, sharing)`. `sharing` gates location upload and
  `GET /api/apple/family` (each member's latest fix). Accounts come from
  `admin.mjs create-user`; a browser signs in with the site's Auth.js cookie; an
  email with no `users` row gets 403. Location is kept for 30 days. Fixes arrive
  about once a minute while moving and none when still; a phone that is still
  gets suspended by iOS, and so goes silent.
- SR-Main runs on the same host (`strange-rambling-svelte.service`), so it reaches
  the pilot on loopback, as SR-Health already does (`companion-service.ts`).
- `allowed_user.role` is `'guest' | 'member'`; `MEMBER_ROUTES` in `$lib/auth.ts`
  lists the route ids a member may reach, by method.
- `notifyOwner` is owner-only: `notification_events` has no recipient. The phone
  has no push certificate, so every in-app alert is **pull**: it arrives when iOS
  next wakes the app, minutes to hours later. WhatsApp can send to any number.

## Design

### 1. Location leaves daydream: `$lib/home/presence`

Move the trail's machinery out of `$lib/daydream` into `$lib/home/presence/`:
`observe.ts` (recordFix/recordGap/prune), `cluster.ts`, `journeys.ts`, the place
refresh, and `loadFamily()` renamed `loadHousehold()`. It is a move, not a rewrite;
the tests move with it. The heartbeat activities become `home-observe` and
`home-places`, seeded `active`. **The tables keep their names** (`daydream_trail`,
`daydream_places`): renaming a table makes `drizzle-kit push` prompt, and a TTY
prompt exits 0 without applying the schema. The daydream P4 plan must drop these two
tables from its retire list.

Until P1 ships, un-pausing `daydream-observe` and `daydream-places` on prod restores
`/home/people` with no code change.

### 2. People, sources and consent: `household_member`

A new table in SR-Main, one row per person:

| column | meaning |
|---|---|
| `subject` (pk) | the trail's existing key (`FAMILY_SUBJECTS`) |
| `email` | site sign-in and pilot user; null for someone on Life360 only |
| `display_name` | |
| `source` | `life360` \| `companion` \| `none`, the source their trail is written from |
| `ha_person_entity` | the Life360 entity, for `life360` |
| `whatsapp` | their number, or null. Only ever in this table, never in code or a page |
| `alerts` | jsonb: whose movements alert them in the app, and whether WhatsApp is on |

`FAMILY_SUBJECTS` and the hard-coded HA entities become a seed of this table.
Owner-only editing on `/home/people/settings`.

**D1, the per-person choice.** The app's onboarding (and Settings → Location)
asks one question: *"Share your location with the household?"* It is off by
default, and it is the pilot's existing `sharing` switch. `home-observe` reads each
person's `source`:

- `companion`: fixes come from the pilot (section 3). If `sharing` is off, the
  person is shown as *not sharing*, **not** silently picked up from Life360.
  Choosing not to be tracked has to mean it.
- `life360`: polled from HA as today.
- An owner switches someone from `life360` to `companion` once their phone is
  paired and sharing. There is no automatic fallback on silence, because silence is
  normal: a still phone is suspended.

### 3. Pilot → SR-Main: `GET /api/apple/household`

A new endpoint on the pilot's service lane with its **own** token
(`APPLE_HOUSEHOLD_TOKEN` in `pilot.env` == `COMPANION_HOUSEHOLD_TOKEN` in SR-Main's
`.env`), separate from the SR-Health token so each can be revoked alone.

`GET /api/apple/household?since=<received cursor>` returns fixes for every user in
the owner's family **with `sharing` on**, in received order, keyed by email:
`{cursor, users:[{email, sharing}], fixes:[{email, recorded, lat, lon, accuracy, speed, moving}]}`.
It is capped per page and the next page follows the cursor. A user whose sharing is
off contributes nothing and appears as `sharing: false`.

`home-observe` (still 120 s) pulls since its stored cursor and writes each fix into
`daydream_trail` with `source='companion'`. `mode` comes from speed, with the same
classifier the trail already uses. Worst-case latency from a fix to the site is
about 2 minutes plus the phone's upload delay (measured at a few seconds while
moving).

### 4. Who can see what: the `household` role

`allowed_user.role` gains `'household'`. A `HOUSEHOLD_ROUTES` list in `$lib/auth.ts`,
shaped like `MEMBER_ROUTES`, opens `/home/people` and its API only. `/home`'s other
rooms (voice, echoes, devices) stay owner-only, and so does `site-nav.ts`, which
shows a household viewer just People (no vendored-nav change).

A household member signs in with the site's normal sign-in. The server maps
`locals.user.email` → `household_member.subject`. D2 is enforced **in the load
function, not the page**: the prod DB role bypasses RLS, so scoping lives in code.

- Everyone: every sharing person's live card (where, since when, home/out, battery
  where known) and today's arrivals/departures feed.
- Own subject only (owner: all): journeys, stats, common trips, the day's track.

### 5. Movement stats

New `$lib/home/presence/stats.ts`, pure and tested, over one person's trail for a
window (default 30 days):

- **Journeys by mode:** count, distance and time on foot, by car and by train, each
  from `journeys.ts`. Mode is labelled as inferred from speed, never as fact.
- **Walking pace:** median and p75 of on-foot journeys ≥ 500 m (average speed, not
  median hop: the median let dawdles through in SR-Health's companion rules),
  weekly trend.
- **Common trips:** journeys grouped by (start place, end place), counting a place
  only if it is labelled. Show pairs seen ≥ 3 times with usual departure time,
  median duration and mode. Unlabelled ends read "somewhere unnamed" and do not
  form trips.
- **Time out:** minutes away from home per day, first-out and last-in times.

Shown on `/home/people/[subject]` as /health-style figures and one chart per
concern (HomeFrame + HealthShell, `dataviz` rules). No map in v1: coordinates
reach a viewer only as their own journeys.

### 6. Alerts: arrive and leave

**Detection** runs in `home-observe` after each write. A person *arrives* at a
labelled place on the first fix inside its radius with accuracy under the radius,
and *leaves* on the first fix outside radius + 50 m. Home counts as a place. Each
crossing writes one row to `household_event` (subject, place, kind, at), deduped on
(subject, place, kind) within 10 minutes. Jitter at the edge is absorbed by the
50 m band.

**In the app (D3, always).** A recipient gets an in-app alert for every arrival and
departure of the people they follow (default: everyone). SR-Main forwards events
to the pilot (`POST /api/apple/household/events`, same token). The pilot keeps a
per-user queue and serves it as `GET /api/apple/alerts` on the phone's existing
companion credential. The phone drains it on every wake and posts local
notifications, the same drain-by-acknowledgement contract as
`/api/native/notifications`. So members never need the owner-only native lane. The
alert is honest about delay: it carries the crossing time ("arrived 17:52"), not
"just now".

**WhatsApp (D3, defined places only).** A place gets a `whatsapp_alerts` flag, set by
the owner on the places panel. A crossing at a flagged place is also sent by
WhatsApp to each follower who has a number and WhatsApp on. It goes through the
WhatsApp service's `sendMessage` with a per-recipient rate floor, and is never sent
to the person who moved. It is not routed through `notifyOwner`, which is
owner-only; each send is logged on the `household_event` row.

**Places panel** (owner): list labelled places, rename, set the radius, toggle
*alerts* and *WhatsApp*. It is the existing `daydream_places` rows with two new
boolean columns.

### 7. Health data for members (D4)

The iPhone app shows the nine Health group toggles to every user, all off by
default for anyone who is not the owner (today they default on). The pilot stores
what arrives. SR-Health's feed stays owner-only (`earliestByKind` and export are
already scoped to the owner), so a member's health reaches no page. Nothing on the
site changes.

### 8. Onboarding a family member (runbook)

1. Owner: add them to `household_member` (settings page), `allowed_user` role
   `household`, and pilot `create-user EMAIL NAME <owner family>`.
2. Add them as a TestFlight tester. External testers need one Beta App Review of the
   build; internal testers need an App Store Connect seat.
3. They sign in on the site, open `/welcome`, pair the phone, and answer the two
   onboarding questions (location sharing; Health, default off).
4. Owner switches their `source` to `companion` once `/home/people` shows their
   fixes.

## Phases

| Phase | Repo | Ships |
|---|---|---|
| P0 | prod | un-pause `daydream-observe` + `daydream-places` (restores /home/people now) |
| P1 | SR-Main | `$lib/home/presence` move, `home-*` activities, `household_member` + seed, Life360 path unchanged |
| P2 | SR-AppleApp | `/api/apple/household`, events + alerts queue, onboarding sharing question, Health defaults off for members |
| P3 | SR-Main | companion ingest in `home-observe`, `household` role + routes, D2 scoping |
| P4 | SR-Main | stats + `/home/people/[subject]` |
| P5 | SR-Main + iOS | detection, `household_event`, app alerts, places panel, WhatsApp for flagged places |

Server before app, always: the pilot ships P2 before any TestFlight build that
calls the new endpoints.

## Testing and verification

- Pure units with tests: stats (pace, trips, mode split), crossing detector (edge
  jitter, accuracy gate, dedupe), D2 scoping (a household viewer never receives
  another person's journeys). The scoping test runs the real load function.
- Pilot: node tests for `/api/apple/household` (sharing off ⇒ no fixes, cursor
  paging, token isolation: the SR-Health token gets 401) and the alerts queue
  (drain by ack).
- Live checks after each phase: P0/P1, `max(ts)` in `daydream_trail` advances every
  2 min; P3, `source='companion'` rows for the owner within 2 min of a fix; P4,
  `/home/people/john` renders with the 25 Sep drives as car journeys; P5, walking out
  of the home radius produces a `household_event` and an in-app alert.

## Not in v1

A live map; driving-behaviour scoring; crash detection; battery alerts; place
suggestions pushed to members; members editing places.

## Decision Log (autonomous run, 2026-09-26)

| Fork | Chosen | Why | Reversible? |
|---|---|---|---|
| Restore /home/people now or wait for P1 | Un-paused `daydream-observe` + `daydream-places` on prod (05:29 UTC); trail writing again for all five | The page had been frozen 9 h; the handlers were still registered | Yes, one status flip |
| Rename the heartbeat activities to `home-*` | No: files move, NAMES stay | A rename seeds new rows and orphans the old ones ("no handler") | Yes |
| Rename the trail/places tables | No | drizzle push prompts on a rename and a TTY prompt exits 0 unapplied | n/a |
| Reuse SR-Health's service token for the household lane | No: own token | Each consumer revocable alone; the SR-Health token must keep opening only its endpoints | Yes |
| Member alerts via SR-Main's native notification queue | No: per-user queue on the pilot | The native lane and `notification_events` are owner-only; members already hold a pilot credential | Yes |
| Life360 fallback when a companion phone goes quiet | None | Silence is normal (a still phone is suspended); a fallback would also defeat "I chose not to share" | Yes |
| Plan detail | Interfaces + test cases per task, code written by implementers against named precedents | Two repos, ~15 files; precedent-led is faster and matches house style | n/a |
