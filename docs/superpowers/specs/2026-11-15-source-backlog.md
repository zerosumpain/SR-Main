# Source backlog: Gmail, Calendar and Drive as a backlog daydream works through

Date: 2026-11-15. Status: design agreed, build in progress. Decisions are logged at the end.

## Why

Measured on production, 2026-11-15:

- 878 threads arrived in 14 days and every one is a subject-line stub with no
  content. 23 threads have been admitted for full reading since August.
- `mail_attachment_files` is empty: the filing engine has no rules.
- The Google connection holds Gmail scopes only. No Calendar, no Drive.
- Daydream's `mail_facts` tool reads sender domain, subject and the dated facts
  of those 23 threads. `mail × suggest` is banned in the rotation because
  "mail bodies are never read, so there is nothing to suggest from".

The intel gate is doing its job (the graph should stay small). The fault is
that the gate is the ONLY reader, so everything it turns away is unread.

## What changes

A second reader beside the gate. Every thread, calendar event and Drive
document becomes one row in `source_backlog`. A tool-less extractor reads the
content once and writes structured facts. Daydream then works through the rows:
one at a time where something needs doing, and in aggregate for patterns.

```
Gmail / Calendar / Drive ──intake──▶ source_backlog (queued)
                                         │ extract (one model call, no tools,
                                         │ fixed schema, code-checked)
                                         ▼
                                     facts (extracted)
                                         │
              ┌──────────────────────────┼─────────────────────────┐
     daydream-backlog drain      `backlog` think tool        Mail room
     (item by item, actionable)  (aggregates, any cycle)     /jkai/daydreams/mail
```

The intel graph, the gate, stubs and the mail-filing rules are untouched.

## The table (`source_backlog`)

Declared in SR-Main `schema.ts`, mirrored in Core, created by hand-applied SQL
(`scripts/migrations/2026-11-15-source-backlog.sql`), never by push.

| Column | Meaning |
|---|---|
| `id` uuid | |
| `space_id` | the account's principal; every read is scoped |
| `source` | `gmail` \| `gcal` \| `gdrive` |
| `ref_id` | `gmail:<thread>`, `gcal:<calendar>:<event>`, `gdrive:<file>`; unique with `space_id` |
| `account_email` | never the Gmail account id (changes on re-link) |
| `observed_at` | when the thing happened, not when it was read |
| `kind` | email kind, or a document kind |
| `title`, `sender_domain` | written by other people; shown as data only |
| `content_hash` | messages only, as `threadContentHash`; a changed thread re-queues |
| `state` | `queued` \| `extracted` \| `skipped` \| `failed` |
| `attempts`, `last_error` | 3 attempts, then `failed` |
| `facts` jsonb, `model`, `extracted_at` | the extractor's validated output |
| `category`, `action_by`, `needs_action` | lifted out of `facts` for indexes |
| `considered_at`, `consideration`, `thought_id` | daydream's side: `note` \| `nothing` \| `aggregate` |

Grants: Core read/write; Main `SELECT` plus `UPDATE` (daydream's three
columns). SR-Infra `registry/runtime-tables.json` lists it under both and
merges with the release.

## Extraction (SR-Jkai-Core)

Two engines in the maintenance process, both copying `mail-files` (pure core,
ports, `.server.ts` adapters, `app_settings` cursor keyed by email, never
throws, `last_run` record, kill switch `SOURCE_BACKLOG=0`).

**Intake** (15 min). Metadata only, no model.
- Gmail forward: history since `backlog.cursor[email].gmail`.
- Gmail backfill: walks backwards a week at a time to 365 days, 500 threads a
  tick, position in `backlog.backfill[email]`. `-in:spam -in:trash`.
- Calendar: `events.list` with a sync token, 365 days back to 365 ahead.
- Drive: `changes.list` from a start page token, plus a one-off listing of
  files modified in the last 365 days. Owned-by-me or shared-with-me, not
  trashed.
- A source whose scope is not on the account is skipped and reported, not an
  error.

**Extract** (15 min). Newest first, so today's mail is never behind the
backfill.
- Text: `threadToNoteText` plus attachment text through `planAttachments` /
  `extractText` (documents; images only on non-bulk mail, through the existing
  vision describe). Bulk mail: 2,500 characters, no attachments. Google Docs,
  Sheets and Slides are exported as text; other Drive files up to 8 MB go
  through `extractText`. Attachment bytes are NOT kept: the VPS disk is at 83%
  and the filing rules already exist for files worth keeping.
- One call on a new `backlog-extract` workload (follows `extraction` unless
  pinned), `temperature 0`, JSON object, no tools.
- Output schema (zod, strict): `summary` ≤300, `category` (enum of 15),
  `parties` ≤5, `amounts` ≤6, `dates` ≤6 with a kind (`due`, `event`, `expiry`,
  `delivery`, `renewal`), `asks` ≤3 (who is waiting on whom),
  `documents` ≤5 (name, type, summary ≤200), `action` (needed, what ≤160, by),
  `change` (a price or term that moved: from, to).
- Checked by code, as the retired receipt extractor did: an amount must appear
  verbatim in the text or it is dropped; a date must parse and sit within ten
  years; URLs and anything that looks like an instruction to a reader are
  stripped from every string. A reply that fails the schema is a failed attempt.
- Calendar events need no model: title, start, end, place and attendee count
  are written by code. A description over 200 characters goes through the
  extractor.
- Caps, because nothing in the estate caps model spend: 40 items a tick;
  `backlog.daily_items` (default 1,500); `backlog.daily_usd` (default 3.00),
  checked against today's `agent_actions` cost for the workload before each
  tick. At about 63 threads a day the 12-month backfill is roughly 23,000
  threads and drains in about 16 days.

## Daydream (SR-Main)

- **`backlog` think tool** (private set). Three modes, all reading `facts` and
  never content: `due` (what needs doing, by when), `search` (category, sender,
  words, dates) and `totals` (by sender or category per month: what recurs,
  what rose). Scoped to the owner's space in the query. `mail × suggest` and
  `mail × correlate` leave the skip table; `tools.test.ts` pins are updated
  deliberately.
- **`daydream-backlog` heartbeat** (30 min, 07:00–23:00, idle 20 min, quota
  guarded). Takes up to 12 unconsidered rows that are worth a look one by one
  (an action, an ask, a date still ahead, a change, or anything from the last
  30 days that is not bulk), seeds them as cards, and asks for at most two
  notes through the existing audit, subject folding and persist path. Every row
  in the batch is then marked `note` or `nothing`. Older rows with nothing
  ahead of them are marked `aggregate` by code and are reachable only through
  `totals` and `search`: 23,000 cycles on the chat model is not a plan.
- **Raising.** Time-critical only: an action due within 7 days, money at risk,
  or someone waiting on him. Those go through the existing raise path inside
  the 4-a-day cap. Everything else is suppressed with `room: mail`, which is
  not a feed-held reason, so it stays out of the Inbox and shows in the Mail
  room. The Sunday digest counts them.
- **Mail room** `/jkai/daydreams/mail`: a deck (read, waiting, backfill
  position, today's spend), what needs doing, the notes raised from the
  backlog, and a searchable list of items with their facts and a link to the
  thread, event or document. Pure `backlog.ts` plus `backlog.server.ts`, as
  Impact and Solutions.
- **Google connection.** `calendar.readonly` and `drive.readonly` join
  `OWNER_SCOPES`; `/admin/connections/gmail` shows which sources each account
  has granted. Members stay Gmail read-only and are not in the backlog.

## The boundary that stays

Daydream still never reads a message body, an attachment or a document. It
reads what the extractor wrote, and the extractor has no tools, a fixed schema,
short fields and code checks. Summaries are model prose derived from other
people's text, so the residual risk is a persuasive summary; the think loop's
private tools are read-only with no web, and the unattended tool contract
already refuses the acts that matter.

## Release order

1. SR-Main: schema declaration, migration applied by hand, grants. SR-Infra
   registry in the same window.
2. SR-Jkai-Core: intake and extract engines. Gmail starts at once.
3. SR-Main: think tool, drain job, Mail room, scopes.
4. John re-connects Google once; Calendar and Drive intake start on the next
   tick.

## Verification

- Core: unit tests on the pure cores with fake ports (cursor moves, backfill
  walks, caps hold, a bad reply is a failed attempt, an unquoted amount is
  dropped).
- Main: `tools.test.ts`, `questions.test.ts`, `hub.test.ts`, the engine-room
  route drift test, the budget `SPENDING_ACTIONS` test.
- Production: `select source, state, count(*) from source_backlog group by 1,2`
  climbs; `app_settings` `backlog.last_run` shows no error; a `think_%` note
  carries a `backlog` card in its evidence; the Mail room renders with real
  rows; the day's `backlog-extract` cost is under the cap.

## Decision log

| Fork | Chosen | Why | Reversible |
|---|---|---|---|
| Which mail | Everything, marketing included | John, 2026-11-15 | Yes: a kind filter at intake |
| Backfill | 12 months | John: annual cycles visible | Yes: `backlog.backfill` |
| Other Google sources | Calendar and Drive in this build | John | Scopes can be dropped |
| Surfacing | Mail room, urgent pushes only | John | Yes |
| Widen the intel gate instead | No, a second reader | The graph is deliberately small and ungroomed; the gate's model is right to say no | Yes |
| Let daydream read bodies | No | Mail is the channel strangers write into | Yes, and it should not be |
| Keep attachment bytes | No | Disk at 83%; filing rules exist | Yes |
| New table vs datastore | Table | 23,000 rows a year, indexed reads by date and state, two apps | Hard |
| Item-by-item for everything | Only where something is ahead | Cost: one chat-model cycle per 12 rows | Yes |
| Google Calendar into `diary` | Not yet | Risk of doubling events already synced to iCloud | Yes |

## Not in this release

- The iPhone app (the room is web only; pushes arrive as daydream notes do now).
- Google Calendar events in the `diary` tool.
- Members' mailboxes.
- Writing anything back to Google.
