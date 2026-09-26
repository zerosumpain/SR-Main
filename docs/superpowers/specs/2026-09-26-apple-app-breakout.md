# Breaking /apple-app apart — onboarding, commuting, devices

Date: 2026-09-26. Owner: John. Status: agreed (AskUserQuestion round, 13:55Z).

## Why

`/apple-app` (the SR-AppleApp pilot's static dashboard, served by the pilot container on the VPS at
127.0.0.1:5295 via cloudflared) has four tabs. Health and Family are duplicated by `/health` and
`/home/people`. Movement is mostly duplicated, except drives/trains, which nothing on the site shows.
Connect & privacy is the ONLY place to pair a phone or see paired devices. We move all of that into the
site so the dashboard can be retired.

## Decisions (John, 2026-09-26)

- D1 Sign-up: BOTH an invite link AND a public request-access form.
- D2 Commuting in /health/activities: own `commuting` category (drive, train, other wheels), with map +
  detail, EXCLUDED from totals, training load, analytics. Train vs car via the speed+straightness test
  /home/people already uses (≥3 fixes ≥55 km/h, bearing change ≤12°).
- D3 /home/people: a "Commuting" section on each person's page listing drives + trains (when, from, to,
  distance, time) with the route drawn on the existing map. Same visibility as that person's journeys
  (own + owner).
- D4 /admin/access/devices: EVERY person's paired phones — companion pairing (pilot) AND chat & news
  pairing (site `native_credentials`) — last used, revoke. Admin nav stops pointing at /apple-app.

## Contract A — new pilot service endpoints (SR-AppleApp, household token)

All on `Authorization: Bearer $APPLE_HOUSEHOLD_TOKEN` via the existing `householdOwner` helper (404 when
unset, 401 on a wrong token, operate within the owner's family ONLY). JSON in/out. Emails lower-cased.

- `POST /api/apple/household/users` `{email, name}` → upsert a user in the owner's family.
  201 `{id, email, name, created:true}` or 200 `{..., created:false}`. Never moves a user who is already in
  a DIFFERENT family (409). `sharing` starts 0 (the phone asks at pairing; unchanged for existing users).
- `POST /api/apple/household/pair-code` `{email}` → for a user in the owner's family: delete that user's
  old pair code, mint a new one (10 min) exactly as `POST /api/apple/pair-code` does. 200
  `{code, payload, expiresIn:600}` where `payload` is the exact JSON string the QR encodes
  (`{"type":"sr-companion-pair","version":1,"server":"<PUBLIC origin>","code":"..."}`). The server origin
  must be the PUBLIC origin (`https://strangeramblings.com`), not loopback — take it from an env var
  `APPLE_PUBLIC_ORIGIN` defaulting to `https://strangeramblings.com`. 404 unknown user.
- `GET /api/apple/household/devices` → every live device credential for every user in the owner's family:
  `{devices:[{id (hash), email, name, label, created, expires, lastUsed|null}]}` (whatever columns exist;
  add last-used only if already tracked).
- `DELETE /api/apple/household/devices/:id` → revoke that credential if it belongs to the owner's family.
  204 / 404.
- `PUT /api/apple/household/sharing` `{email, enabled}` → set that user's sharing. 200 `{sharing}`.

Tests in `server/test/app.test.mjs` style for each, including wrong token, cross-family refusal.
Also change iOS copy that sends people to "Connect & privacy on your dashboard" /
"strangeramblings.com/apple-app" to "strangeramblings.com/welcome" (strings only).

## Contract B — SR-Main onboarding (`/welcome`)

Tables (schema.ts, self-contained, no local imports):
- `access_invite`: id, code_hash (sha256, unique), email (nullable = anyone with the link), name, note,
  groups jsonb (group ids, e.g. `['family-circle']`), created_by, created_at, expires_at (default +14d),
  used_at, used_by_email, revoked_at.
- `access_request`: id, email (lower), name, message, wants (jsonb: e.g. `{app:true}`), status
  (`pending|approved|declined`), created_at, decided_at, decided_by, ip_hash.

Flows:
1. Invite: owner mints at /admin/access (new "Invites" panel: optional email, name, groups
   checkboxes from existing groups, → one-time link `https://strangeramblings.com/welcome/<code>` with
   copy button + QR). `/welcome/[code]` shows who invited them + what they get → "Continue with Google".
   Before redirecting to Google the code is put in a short-lived httpOnly cookie. In the Auth.js
   `signIn` callback: if the email is not already allowed AND the cookie holds a valid, unexpired,
   unused invite (whose email, if set, matches) → accept: upsert `allowed_user` with the invite's groups
   (same write path /admin/access uses), mark invite used. Anything else behaves exactly as today.
2. Request access: `/welcome` (public) has a short form: name, email, what for (optional). Rate-limited
   (existing `public-request-rate-limit`). Stored as `access_request` pending; owner notified through the
   existing notification seam (one category). Owner sees Requests on /admin/access → Approve (pick groups
   → adds `allowed_user` exactly like the add form) or Decline. Approved people just sign in at /welcome.
   The public response never reveals whether an email is already known.
3. Guided setup (signed-in, allowed): `/welcome` (and `/welcome/[code]` after sign-in lands on it) shows
   three steps: (1) Install — TestFlight link from env `APPLE_TESTFLIGHT_URL` (hide the button if unset,
   say "ask John for a TestFlight invite"); (2) Pair — server calls Contract A `household/users` (upsert
   with their name/email) then `household/pair-code` and renders the QR server-side as a data URL (same
   `qrcode` lib the native-devices endpoint uses) + manual code + 10 min countdown + "new code" button;
   (3) Location sharing — explain, toggle via `household/sharing`. Owners also see a 4th card: chat &
   news pairing via the existing `/api/admin/native-devices` POST. (Members' chat & news lane is being
   built in another session — `feat/member-device-lane`; do NOT touch native-auth/native-gate.)
   Pairing requires `family:circle` (or owner); a signed-in allowed user without it sees steps as "ask
   John to add you to Family Circle".
   Public paths: `/welcome` and `/welcome/[code]` must be reachable signed-out (check how `/login` is
   exempted in hooks + the access catalogue / public-routes gate), and chrome-less like /login.
Design: SR design system (repo skill `sr-design`), copy `/login`'s centred card language but a pretty
stepped layout; phone-first. No new fonts.

## Contract C — SR-Main /admin/access/devices

Owner-only page listing (a) site `native_credentials` devices for ALL owners/members (not just the
viewer), (b) pilot devices via Contract A `GET household/devices`. Columns: person, which pairing
("Health & location" / "Chat & news"), label, paired, last used, expires, Revoke. Pilot unreachable →
section shows "app server unreachable", site section still works. Remove the `/admin/access/devices →
/apple-app` redirect and point the admin-nav Devices item at `/admin/access/devices` with a normal match.
Also let the owner mint their own chat & news code here (same as old Connect & privacy).

## Contract D — SR-Main /home/people commuting

On `/home/people/[subject]`: a "Commuting" section listing journeys whose mode bucket is car or rail
(existing `segmentJourneys` / `railJourney` / `modeBucket`), newest first, 30 days: date, start→end place
names when known, mode, distance, duration, avg speed; clicking one draws its route on the page's
existing map (or a small map per row if there is no page map). Same visibility as existing journeys.

## Contract E — SR-Health commuting

In `src/lib/trails/companion.ts`: instead of discarding "wheels" pieces, collect consecutive fast runs
into commuting outings: type `drive` | `train` | `commute` (other wheels, e.g. bus/bike), category
`commuting`. Keep: ≥ 5 min, ≥ 1 km. Train test as D2. Ids `companion:<startEpoch>` must stay unique
(use a distinct prefix for commuting e.g. `companion:c<startEpoch>` if collisions possible; the detail
route must resolve them). Labels in format.ts; a "Commuting" chip in the ledger; excluded from the
ledger totals and from `mergeOutings` totals; `listActivities()` (analytics etc.) untouched;
`/api/trails/activities` (used by SR-Main native-trails → iPhone) EXCLUDES commuting unless
`?include=commuting` so the phone's list is unchanged. Detail page works (map, speed not pace).

# Phase 2 — retire the /apple-app dashboard (John: "do that then", 2026-09-26 ~15:10Z)

## Contract F — pilot (SR-AppleApp), household token as before
- `POST /api/apple/household/data/delete` `{email}` → exactly what `DELETE /api/apple/data` does for that user
  (health, tombstones, locations, alerts, device + pair credentials wiped; sharing=0). Owner's family only; 404 unknown.
  200 `{deleted:{health:n, locations:n, ...}}` (counts if cheap, else `{ok:true}`).
- `GET /api/apple/household/day?email=&from=<ISO>&to=<ISO>&tz=<minutes offset>` → for that user, the SAME payload the
  dashboard's Movement tab builds from `/api/apple/track` + `/api/apple/timeline` for that window (track fixes, segments,
  activities/journeys, heart-rate, workouts, sleep unioned, step RECORDS). Reuse server/movement.mjs functions — no copy.
  Window ≤ 48 h (400 otherwise). Owner family only.
- `/apple-app` and `/apple-app/*` (the static dashboard) → 308 to `https://strangeramblings.com/welcome` (use
  APPLE_PUBLIC_ORIGIN), EXCEPT when DEMO_MODE local preview needs it? No — delete the dashboard: server/public/*,
  its static serving, scripts/browser-check.mjs parts for it, and docs that describe it. `/api/apple/*` untouched,
  including session-auth endpoints (the iPhone uses device auth; keep session paths working, they're harmless).
  Keep `/api/apple/pair-code` (session) etc. as-is.

## Contract G — SR-Main
- `/welcome` signed-in: a quiet "Your data" section at the foot: "Delete my uploaded data" (health & location records
  the app uploaded; unpairs the phone; Apple Health on the phone untouched) with a typed/two-step confirm → Contract F delete.
  Only when the person has a pilot account (pilot 404 ⇒ show nothing). Also note the site's own /home/people trail is
  separate — say what it does and does not delete, honestly (does the household trail copy in daydream_trail get removed?
  Decide: ALSO delete that person's `source='companion'` trail rows in SR-Main, since the user expects "my location data"
  gone; state it in the confirm text).
- `/home/people/[subject]` "Your day" section: ONLY when the viewer IS that subject (their own page; owner on own page).
  Day picker (today default, back 30 days), map of the day's track (reuse CommuteMap/mapbox pattern), timeline strip under
  it: heart rate line, sleep bands, workouts, step records; scrubbing the timeline moves a dot along the track (the
  dashboard's behaviour — read SR-AppleApp server/public/movement.js + map.js on origin/main for exact semantics: segments
  split >600 s gaps drawn dashed, days bucketed in the browser's tz offset, sleep unioned). Data from Contract F `day`
  via a server endpoint/loader keyed on the signed-in email (never a subject param for someone else).
- Admin nav / any remaining links to /apple-app → /welcome or removed.
