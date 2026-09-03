# Daydream feed focus — P2 of the 2026-09-02 overhaul

Autonomous build. Brief: John's ask (2) — "intel links if verified by jkai
should just be linked, they're not noteworthy. Still getting duplicates.
memories not clearly linked." Items 2.1–2.8 of the slate; decisions D2(a)
and D7(a) taken as recommended.

## What was measured (production, 2026-09-02)

- 4 of 5 live `intel_missing_link` thoughts were `verified` and none was
  woven; 5 graph links had been sent to WhatsApp.
- Dedupe was exact `dedupeKey`; the evidence-identity guard fired only against
  `refuted` rows. "A clear window before school resumes" was live twice.
- Eleven live cards shared one title (one per unnamed place).
- `uncertain` was the largest verdict bucket, 13 live rows held as
  `uncertain_after_review`, most of them the reviewer failing to retrieve.
- Memory refs on a card had `href: null`; note memories were not selected;
  named-place memories carried no `daydreamOrigin`.

## Design

### 2.1 A verified graph link is applied, not announced

`recordReview` is the one writer of verdicts. For a `verified` verdict on a
graph-family kind (`intel_*`) it now calls `applyVerifiedGraphLink`: the
weave runs (the endorsement the graph already accepts), the source insight
is set `actioned`, and the thought is archived with `suppressedReason:
'applied'` — so it never becomes a delivery candidate. `daydream-intel` also
runs `applyPendingGraphLinks()` (the four already verified on prod) and
`syncInsightStatuses()`: a bridged thought whose insight was dismissed or
actioned on `/jkai/intel` is archived here with reason `insight_<status>`.

### 2.2 Same-claim guard over every live row

`loadLiveClaims()` reads unfiled rows from the last 30 days; `liveEchoOf`
uses the existing containment rule (`isSameClaim`, `MIN_SHARED_REFS`) and,
for musings whose refs are mostly aggregates, a trigram title similarity
≥ 0.6 within the same family and 7 days. A candidate that echoes a live row
MERGES into it — recurrence up, score raised if higher — instead of
inserting. The refuted path is unchanged.

### 2.3 One card per subject

Date-scoped keys stay (a new day's event must still be able to exist once the
owner has filed the last one). The FEED rolls them up: `subjectKey(dedupeKey)`
strips a trailing `:YYYY-MM-DD` / `:YYYY-Www` segment; `loadFeedCell` keeps the
newest row per subject and carries `siblings` (count + dates) for a
recurrence strip.

### 2.4 / 2.5 The default view

The default cell is undecided across every family EXCEPT places, plus
anything sent in the last 24 hours. Place questions are the Places room's:
the matrix's places cells link there, and the default list carries one line
"N places to name" instead of N rows.

### 2.6 Retrieval failure is a fault, not a verdict

`isRetrievalFailure(result)` — no sources, or reasoning that says it could not
retrieve/resolve/find the cited rows. Such an `uncertain` is held with
`suppressedReason: 'needs_source'`, the verdict column stays honest, and the
weekly counter of uncertain verdicts excludes it. The fault ledger is P5.

### 2.7 Memory on the face and in the drill

`loadFeedCell` attaches the names of cited memory themes; the row shows
"memory: <theme>" chips linking to `/jkai/daydreams/memory#memory-theme-<id>`.
Memory refs in `evidence.ts` link to `#memory-<id>`; `MemoryCard` gains that
anchor. `LedgerThought` carries `noteMemoryId`; the drill links the ruling
memory, the note memory and every cited theme. `confirmPlace` stamps
`daydreamOrigin: 'place'` and the scope boundary admits it.

### 2.8 Auto-file

`expireStale(now)`: delivered or seen, verified, unrated, delivered more than
7 days ago → status `expired`, no verdict recorded. `expired` joins
`PROTECTED_STATUSES` (or the ten-minute re-detection would undo it — the same
trap `archived` sprang). Runs beside `wakeSnoozed` in `daydream-detect`.

## Verification

- Unit: `subjectKey`, `titleSimilarity`, `liveEchoOf`, `isRetrievalFailure`,
  PROTECTED_STATUSES includes `expired`.
- porkserv gate with build; the five lint gates.
- Screenshots with `uiseed-` fixtures that include a date-scoped pair and a
  theme-cited musing.
- Live, after deploy: the four verified graph thoughts read `archived /
  applied` after the next `daydream-intel` tick; `expired` rows appear after
  the next detect tick; no new duplicate pair in 24 hours.

## Decision Log

| # | fork | chosen | why | reversible |
|---|---|---|---|---|
| 1 | "apply" a graph link by an entity-merge primitive vs the weave | the weave | no link/merge action exists in the closed action vocabulary; the weave is the endorsement path the graph already trusts, and adding a capability grant is a security decision for its own PR | yes |
| 2 | merge target keeps the old phrasing vs takes the new | keeps the old | the verdict, the ruling memory and any note attach to the existing row's text; recurrence records the re-proposal | yes |
| 3 | change date-scoped dedupe keys vs roll up in the feed | roll up | a filed card must not swallow next week's event (`PROTECTED_STATUSES`) | yes |
| 4 | title similarity in SQL (`pg_trgm`) vs in code | code | one query for the live rows, pure and testable, no per-candidate round trip | yes |
| 5 | `needs_source` as a new verdict vs a suppressed reason | reason | the verdict column stays what the reviewer said; the reason is why it is held | yes |
| 6 | expiry window | 7 days | D7(a) as recommended | one constant |
