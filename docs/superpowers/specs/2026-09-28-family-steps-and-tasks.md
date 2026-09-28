# Family steps leaderboard + family task list

Date: 2026-09-28. Repos: SR-Main (server), SR-AppleApp (iPhone app + widgets).
SR-Main is a PUBLIC repo: no family names, emails or phone numbers in code, tests or docs.

## Decisions (John, 2026-09-28)

- A. Both: in-app screens (under More) + an opt-in Today card for each (per person, per phone) + iOS Home Screen widgets.
- B. Leaderboard = EVERYONE in the family (owner, or `family:circle` / `family:admin`) who has a companion (pilot) account with steps.
  Top spot checked every 15 min, 08:00–21:00 Europe/London; the person knocked off is pushed, at most 2x per day.
  Everyone on the board gets a 4pm (Europe/London) push with their place. Resets daily (London day).
- C. Tasks: optional assignee; a parent confirms OR sends back with a note; a confirmed reward stays OWED until a parent marks it paid.
  Parents are pushed when a task is marked done; the doer is pushed when confirmed / sent back. The assignee is pushed when assigned (by someone else).
- D. Reward: kind `cash | day_out | game_time | lunch_out | other`. Cash REQUIRES a £ value; categories take an OPTIONAL £ value and/or note.
  "Rewards owed" totals the £ and lists the rest.

**Parent** = owner OR holds `family:admin` (`familyLevel(...) === 'parent'` in `$lib/access/roles.ts`).
**Family member** = owner OR holds `family:circle` or `family:admin`. Everyone else: 403.

## Server (SR-Main)

### Steps

Source: the pilot, via `pilotDay(email, window)` (`$lib/home/presence/companion-accounts.ts`). Today's count = the `timeline.steps`
record whose span sits in TODAY's London day (one cumulative record per local day; pick, never sum; take the max `value` among
records that start inside today's window). Pilot values are RAW (the ×100 trap is only in `apple_health_metrics`). 404 / no account → not on the board.

Roster: shape of `gamePlayers()` (`$lib/games/players.server.ts`): member = owner or family grant; names from `listMembers()`;
person id = the same keyed-hash style (`playerId`-like, prefix `f_`) so the phone never carries other people's emails.
Roster source = pilot users (the list `pushAppViews` iterates) filtered by family grant — NOT only site-paired devices.

Tables (`src/lib/db/schema.ts`):
- `family_steps_day` (day date, email text, steps int, updated_at timestamptz; PK(day,email)) — upserted by the poll. Keeps history.
- `family_steps_event` (id serial, day date, email text, kind text `dethroned|standings`, at timestamptz) — caps + dedupe.
- Leader for the day is derived: rank 1 of `family_steps_day` for the day, ties broken by who reached it first (earlier updated_at).

Heartbeat activities (`src/lib/heartbeat/activities/`, registered in `registry.ts`, precedent `daydream-bank.ts`):
- `family-steps`: cadence 900 s, active 08:00–21:00 Europe/London. Refresh every roster member (sequential, 8 s timeout each), upsert,
  compare the leader before/after. If the leader CHANGED and the old leader now ranks lower (not a tie), push the old leader
  "Knocked off the top — <new> has <n> steps, you have <m>." unless they already had 2 `dethroned` events today. Tapping opens the leaderboard.
  No push for the very first refresh of a day (no previous leader).
- `family-steps-4pm`: daily, active 16:00–16:30 Europe/London. Refresh, then push every person on the board:
  "You're 2nd of 5 with 8,412 steps — 1,020 behind <leader>." / leader: "You're top with 12,300 steps — 1,900 ahead of <2nd>."
  Dedupe with one `standings` event per person per day. Skip if the board has < 2 people.
- Push via `pushToEmails` (`$lib/server/push-devices.ts`), precedent `$lib/games/invite-push.server.ts`. Push `url`/deep link:
  `sr://family/steps` and `sr://family/tasks` (the app maps them; check the app's existing deep-link scheme and use it).

Routes (`withNativeAccess('any', …)` + family check, precedent `src/routes/api/native/companion-pair/+server.ts`; view-as honoured
automatically by the native gate):

`GET /api/native/family/steps` →
```json
{ "day": "2026-09-28", "updatedAt": "ISO|null", "people": [
  { "id": "f_ab12…", "name": "Sam", "steps": 8412, "rank": 1, "me": false, "updatedAt": "ISO" } ] }
```
Reads the stored rows (no pilot call per request). Ranks: 1..n, ties share a rank. `me` marks the caller. People with no row today
appear with steps 0 at the bottom. Also `yesterday: { leaderName, steps } | null` for a small "yesterday's winner" line.

### Tasks

Table `family_task`:
id uuid pk, title text (1–120), notes text null (≤1000), deadline date null, assignee_email text null,
created_by_email text, status text `open|done|confirmed|deleted`, done_by_email null, done_at null,
sent_back_note text null, sent_back_at null, confirmed_by_email null, confirmed_at null,
reward_kind text null (`cash|day_out|game_time|lunch_out|other`), reward_pence int null (≥0, ≤100000), reward_note text null (≤80),
reward_paid_at null, reward_paid_by_email null, created_at, updated_at.
Validation: reward_kind=cash ⇒ reward_pence > 0 required. No reward_kind ⇒ pence/note must be null.

`GET /api/native/family/tasks` →
```json
{ "me": { "id": "f_…", "parent": true },
  "people": [ { "id": "f_…", "name": "Robin" } ],
  "open": [ Task ],            // status open|done (done = awaiting a parent), deadline asc nulls last, then created
  "completed": [ Task ],       // confirmed; a member sees their own (doneBy = me); a parent sees everyone's; newest first, last 90 days
  "owed": { "totalPence": 1500, "items": [ Task ] }  // confirmed, reward set, not paid. Member: their own; parent: everyone's
}
```
Task = `{ id, title, notes, deadline: "YYYY-MM-DD"|null, assignee: PersonId|null, createdBy: PersonId, status,
doneBy: PersonId|null, doneAt, sentBackNote, confirmedBy, confirmedAt,
reward: { kind, pence: int|null, note: string|null, paidAt: ISO|null } | null, createdAt }`.
Persons are referenced by id; the phone resolves names from `people`.

`POST /api/native/family/tasks` body `{ title, notes?, deadline?, assigneeId?, reward? {kind, pence?, note?} }` → `{ task }`. Anyone in the family.
`PATCH /api/native/family/tasks/[id]` body `{ action, ... }`:
- `done` — anyone; open → done; sets doneBy = caller; clears sentBackNote. Push parents (not the caller): "<name> finished: <title>".
- `undo` — the doer or a parent; done → open.
- `confirm` — parent only; done → confirmed. Push the doer: "Confirmed: <title>" (+ " — £5 owed" etc).
- `send_back` `{ note }` — parent only; done → open with sentBackNote. Push the doer.
- `paid` — parent only; confirmed + reward + unpaid → reward_paid_at now.
- `edit` `{ title?, notes?, deadline?, assigneeId?, reward? }` — creator or parent, only while open.
- `delete` — creator or parent; soft (status deleted).
Wrong state ⇒ 409; not allowed ⇒ 403; unknown id ⇒ 404. View-as is look-only (native gate already 403s non-GET).

Tests: pure logic in `$lib/family/*.ts` unit-tested (ranking, today's record pick, dethrone decision + cap, 4pm message text, task
state machine + permissions, reward validation, owed totals). Route tests mock `withNativeAccess` like
`src/routes/api/native/chat/attachments/attachments-route.test.ts`.
Schema push: prod via CI's drizzle push — check `tablesFilter` (memory: new table + prod's undeclared ones hangs CI) and that CI handles new tables.

## App (SR-AppleApp)

- `Family/Steps*` and `Family/Tasks*` (store + screen each), following `Games`/`Family` store patterns and `SiteClient`.
  Both need the SITE pairing (the app's `SiteClient`); hidden for people without the family grant (AccessStore flags — add a
  `family` check the same way Today's family card does).
- More tab: two rows, "Steps" and "Tasks" (`AccessPolicy.inMore`, `Router.more`, destinations on the stack root — see project memory on #54).
- Today: `TodayStepsCard` (your place + top 3) and `TodayTasksCard` (open count, awaiting-you count for parents, owed total).
  Each is OFF by default, toggled in Settings → "Today" (UserDefaults keys `today-card-steps`, `today-card-tasks`) and also via a
  "Show on Today" toggle on each screen.
- Steps screen: ranked list, big number for "you", pull-to-refresh, "updated hh:mm", yesterday's winner line. Your own row may
  overlay the phone's live HealthKit count if higher (label it "live").
- Tasks screen: segmented Open / Completed / Owed (Owed tab: parents see everyone's, grouped per person, with "Mark paid").
  Add sheet: title, notes, deadline (toggle + date), assignee picker (None + people), reward toggle → kind picker
  (Cash, Day out, Game time, Lunch out, Other) + £ field (required for Cash) + note. Row swipe: Done; parents on a done task: Confirm / Send back (note alert).
- Push deep links route to the two screens.
- Widgets: add `StepsWidget` and `TasksWidget` (systemSmall + systemMedium; accessoryRectangular optional) to the existing
  `SRAppleLive` WidgetBundle. The extension can't see the app: the app writes a small JSON snapshot for each (steps board, tasks summary)
  somewhere the extension can read and calls `WidgetCenter.shared.reloadTimelines`. Prefer an App Group ONLY if the provisioning
  profiles already carry it for the phone app + extension — check how TestFlight gets profiles (#53, #63/#66/#67 entitlement history)
  before adding an entitlement; if an App Group would need a profile change, use a shared Keychain access group
  (`$(AppIdentifierPrefix)…`, allowed by default profiles) to store the snapshot or the site credential for the widget to fetch
  itself, with a 15–30 min timeline policy. Must not break the TestFlight build.
- Copy: British English, SR design system (Archivo Black display, DM Sans body, JetBrains Mono labels/figures, tokenized palette).
- Demo fixtures (`-SRDemo`) fill both screens and cards so CI screenshots show them. UI test opens both via `openTab`/More.
