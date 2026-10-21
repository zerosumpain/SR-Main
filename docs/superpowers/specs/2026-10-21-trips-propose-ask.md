# Trips v8 — propose, research, ask (wire contract)

21 October 2026. Plan (owner-readable): `~/site-tech-debt-review-2026-09-26/2026-10-21-trip-planning-propose-and-ask-plan.md`
(Drive `Architecture/2026-10-21-trip-planning-propose-and-ask-plan.md`). Types: `src/lib/trips/decisions.ts`.
Storage: `src/lib/trips/decisions.store.server.ts`. Dry run: `src/lib/trips/dryrun.ts`.
Schema: `trip_proposal`, `trip_question`, `trip_place`, `trip_job` + `trip.provenance`, `trip.pack`,
`trip_plan.constraints` (`scripts/migrations/2026-10-21-trips-decisions.sql`, hand GRANT at release).

## Hard rules

1. **Backward compatible.** The family are in Rome 26–30 Oct on the current app build. Every existing endpoint keeps
   its request and response shape; v8 only ADDS optional fields and new endpoints. `ConverseResult` keeps `reply`,
   `applied`, `rejected`, `quickReplies`, `planVersion`, `changes`, `research`, `options` and gains `proposals?`,
   `questions?`, `brief?`. The bundle gains optional `brief`, `questions`, `answered`, `proposals`, `pack`.
2. **The server owns decisions.** Proposals, questions, diffs and the brief are computed and stored on the server; the
   site and phone only render them and post choices back by id. Accepting a proposal replays its stored, checked ops
   (`trustsPlaces: true`) — never a sentence through the chat, never ops from the client.
3. **Nothing changes silently.** Every change — accepted proposal, answered question, direct edit, background re-plan
   (research finished) — appends a version whose `changes` say what moved, and the bundle's `plan.changes` /
   `ConverseResult.changes` carry it. A background re-plan that moves things also logs an `event` message.
4. **Never invent, never hide a guess.** Every brief fact has a `FactSource`. A planner-set fact without a stated
   source is `assumed` and is shown amber with Right/Change.
5. **Questions only when they matter.** A question is stored only if at least two of its answers dry-run to different
   plans (or differ in a brief fact the solver reads). ≤ 3 open shown; always a default ("You decide"); never the same
   key twice while open; a skipped key is not re-asked unless its answers' plans change.
6. **Locked and booked never move** in any proposal or answer (the solver already honours `locked`/bookings; dry runs
   must not add ops that unlock them unless the person asked).
7. **Cost.** Model calls go through `src/lib/trips/llm.server.ts` / the `trips-planner` workload (the cost-aware
   router). No hard-coded model. The research pack has a fixed budget per build.
8. **Owner/member separation, and no memory on the phone.** Memory (`notes`) is owner-only: `NoteFact`s and
   `remember` only for the owner. The v5 rule stands: NO memory text on the phone wire for anyone, the owner
   included — the phone brief (`phoneBrief`) drops preference/constraint items and nulls `note`/`ref` on `notes`
   items; `GET notes` returns labels built from trip facts (dates, carrier, flight number, area), never memory
   sentences. Wire field names: a fact's provenance is `origin` (never `source`, which the privacy test reserves
   for memory). Family members never see memory text. Questions have an `audience`; members see `family` questions only.
   Proposals are for editors (creator, parents); members keep "suggest".
9. British English, plain words, sentence case, no emoji.

## Endpoints

Site (owner session, `requireTripOwner`) under `/api/trips/:id/…`; phone (`withNativeAccess` + `familyTrip`) under
`/api/native/trips/:id/…`. Same bodies and responses on both unless noted. Long work accepts `"async": true` →
`202 { job }` and is polled at `…/trips/jobs/:jobId` (both prefixes); `DELETE …/trips/jobs/:jobId` cancels.

| Method | Path | Body | Response | Owner |
|---|---|---|---|---|
| GET | `decisions` | — | `DecisionsWire` (`decisions.bundle.server.ts`) | S1 |
| POST | `proposals` | `{ kind: 'swap'\|'fill'\|'day'\|'nudge'\|'shapes', target: { stopId?, wishId?, date?, stage?, proposalId? }, nudge?: Nudge, variant?: 'lighter'\|'rainy'\|'swap-days', withDate?, async? }` | `{ proposals: Proposal[] }` (one group) | S1 (`shapes` → S2) |
| POST | `proposals/:pid` | `{ action: 'accept' }` \| `{ action: 'reject', reason: RejectReason, note? }` | accept: `{ proposal, planVersion, changes, diff, undo: { toVersion } }`; reject: `{ proposal }`; `409` if no longer open; `409 { stale: true, proposal }` if the plan moved and the re-check differs (the client shows the new diff and accepts again) | S1 |
| POST | `questions/:qid` | `{ action: 'answer', answerId }` \| `{ action: 'decide' }` (default) \| `{ action: 'skip' }` \| `{ action: 'vote', answerId }` (family) | `{ question, planVersion, changes, diff, undo: { toVersion } \| null, remember: string \| null }` | S2 |
| POST | `undo` | `{ toVersion?: number }` (default: the version before the latest) | `{ planVersion, changes, diff }`; `409` if that version has no snapshot | S1 |
| GET | `versions` | — | `{ versions: Array<{ version, source, createdAt, changes, restorable }> }` | S1 |
| PATCH | `brief` | `BriefPatch` | `{ brief, planVersion, changes }` | S1 |
| GET | `pack` | `?kind=&tag=` | `{ pack: PackSummary, places: PackPlace[] }` | S2 |
| POST | `pack` | `{ action: 'build'\|'refresh'\|'more', theme?: string, async? }` | job → `{ pack, places }` | S2 |
| POST | `/api/native/trips` (and `/api/trips`) | v8 adds `{ start: TripStart, async: true }` beside the existing `{ text }` | job; `result: { id }` kept as soon as the trip exists; stages: brief → research → shapes → questions | S2 |
| GET | `/api/native/trips/notes?destination=&startDate=&endDate=` (and `/api/trips/notes`) | — | `{ notes: NoteFact[] }` — owner only; `[]` for anyone else | S2 |
| DELETE | `/api/native/trips/jobs/:jobId` (and site) | — | `{ job }` (status `cancelled` once the work stops) | S2 |

`converse` (existing) returns v8 fields: `proposals` (stored, checked, grouped), `questions` (stored), `brief`.

Jobs: `TripJob` gains `tripId: string | null`, `stages: JobStage[]`, status `cancelled`. Kinds add `pack`,
`shapes`, `start`, `proposals`. State persists in `trip_job` (in-memory map stays as a cache for the running
process); a poll after a restart reads the row (an orphan reads `failed` with "The server restarted — try again",
never 404). `handle.stage(key, state, detail?)` and `handle.cancelled()` are added to `JobHandle`.

## The planner turn (v8)

The model answers `{ reply, ops, proposals, questions, quickReplies }` (`PlannerAnswerV8`; `options` still read and
converted to a `fill` proposal group for compatibility). Policy, in the system prompt and enforced after:

| Situation | Planner does |
|---|---|
| Clear, small, reversible | `ops` (acts). The turn's diff is returned with `undo`. |
| Clear but large (> 4 stops move, or a booked/locked slot is involved) | One `change` proposal to approve. |
| Open ("ideas", "somewhere for dinner", "it's raining") | A group of 2–3 proposals (`fill`/`swap`/`day`), drawn from the research pack when it has candidates (`packPlaceId`). |
| Missing/uncertain fact that changes the plan | Assume, set it with `source: 'assumed'`, and add a question. |
| Nothing it can do | Say so in one line. |

`emptyPromise(reply, …)` guards the Darlington failure: a reply promising ideas/changes with no ops and no proposals
is retried once with a correction message; if still empty, the reply is replaced by "I couldn't turn that into a
change — here's what I can do:" plus a pack-based `fill` group when possible.

Ops may carry `"source": "you"|"notes"|"found"|"assumed"` and `"sourceNote"`; the turn records provenance for the
row each op creates or edits. A model op without `source` on a fact the person did not state is `assumed`.

## The research pack (S2)

- Built by a `pack` job when a trip is created (and on destination/date change); refreshed 7 days before the start
  (on the first bundle read inside that window) and on demand ("Look further").
- Sources: OpenStreetMap (Overpass/Nominatim, the existing queue) for candidates within the trip's area; Wikidata/
  Commons for images and the "famous" signal (sitelinks count → `lessVisited` = low sitelinks); web search (Tavily via
  the existing agent tools, when a key is registered) + ONE model synthesis call per batch to write `why`, kind,
  duration, indoor, kidFriendly, cost, booking lead time, with sources. Calendar: public holidays (date-holidays or a
  search), closures found in facts, sunrise/sunset (computed), typical weather (Open-Meteo climate, no key).
- Budget per build: ≤ 6 searches, ≤ 3 model calls, ≤ 80 OSM-derived candidates kept to ~40–60 places.
- Without a search key (local preview), it still builds from OSM + Wikidata + the model, marking facts it could not
  check as unknown.

## Questions (S2)

Generators (each emits `QuestionDraft`s; all go through the same check):

- **brief**: dates/destination placeholders, travellers unknown, stays missing nights → asked with a default applied.
- **tie**: two shapes (or two day versions) whose solver scores are within 10 % → "which matters more".
- **clash**: a must/booked wish dropped or a day over-full → the clash as a choice.
- **research**: a planned place with `bookAheadDays` and no booking (deadline = day − bookAheadDays); a planned place
  closed on its day; rain on a day with outdoor stops (when weather is known).
- **reaction**: two turn-downs with the same reason → a standing preference question ("Keep everything within 20
  minutes' walk of the flat?").
- **planner**: the model's own (`readQuestionDrafts`).

Check: dry-run every answer (`dryrun.ts`) from the current plan; drop the question if all answers give the same plan;
`impact` = max stops changed across answers × urgency (deadline within 14 days ×2, within 3 days ×3); keep the top 3
open per audience; store. Answering applies the answer's ops (trusted), appends a version, returns the diff + undo.
A family question collects votes; a parent's answer (or the creator's) decides it.

Pushes: at most one question notification per trip per day before the trip (`QUESTION_PUSHES_PER_DAY`), category
`trip-question`, payload `{ tripId, questionId, prompt, answers: [{id,label}] }` (the app's notification content
extension draws the chips).

## Shapes (S2)

At the end of the `start` job (and on request), the model picks 2–3 themed selections from the pack (each: a
headline, 8–14 pack place ids, which days for which themes); each selection is dry-run as a whole (`addWish` ops with
pack places, trusted) on top of the brief's fixed items; shapes whose plans differ in fewer than 3 stops are merged;
each is stored as a `shape` proposal with `shape: ShapeSummary` and `tradeoffs` (walkKmPerDay, earlyStarts, toBook,
lessVisited count). Accepting one applies its ops and expires the other shapes.

## Swaps, fills and nudges (S1, fast path)

`POST proposals {kind:'swap'|'fill', target}` draws ≤ 12 pack candidates near the slot (distance from the stop
before/after, open then, not already planned, not rejected), dry-runs each, keeps the best 3 that fit (at least one
`lessVisited` when one fits), stores them as a group. `nudge` re-ranks from the same slot: closer (walk), cheaper
(cost text / free), less-walking (day walk delta), quieter (lessVisited), more-like-this (same kind/tags). Target
latency < 2 s (no model call, no web search). If the pack is empty or not ready, fall back to the existing ideas
search (async job) and say so.

Day variants: `lighter` (dayLoads light), `rainy` (swap outdoor stops for indoor pack places), `swap-days` (exchange
the day's unlocked wishes with `withDate`).

Rejecting with a reason marks the pack place `rejected` with the reason, and feeds the reaction generator.

## Undo (S1)

Every appended version stores `constraints` (`constraintsOf`). `undo {toVersion}` restores that snapshot: rewrite
trip fields, stays, wishes (re-insert removed ones with their ids, delete added ones), bookings and transport to the
snapshot, then `replan` (which appends a NEW version — history is never rewritten) with `changes` led by
"Undone: …". Phone-sourced versions (`storePhoneDays`) carry the latest snapshot forward.

## Wire fixtures

`src/lib/trips/fixtures/decisions-wire.json` holds one example of every v8 wire shape (Proposal of each kind, Question
open/answered, PackSummary, PackPlace, TripBrief, JobStage list, DecisionsWire). Server tests assert the TS types
accept it; the app decodes the same file (`ios/SRAppleAppTests/Fixtures/TripDecisions/decisions-wire.json`) in its
tests. Change both together.

## Who builds what

- **S1 — proposals core:** `proposals.server.ts`, `brief.ts` (full), `undo.server.ts`, converse v8 + prompt v8,
  provenance recording, routes `decisions`, `proposals`, `proposals/:pid`, `undo`, `versions`, `brief` (site +
  native), tests.
- **S2 — research, questions, shapes, jobs:** `jobs.server.ts` (durable, stages, cancel), `pack.server.ts`,
  `questions.server.ts`, `shapes.server.ts`, `notes.server.ts` (NoteFacts), `start.server.ts` (guided create
  pipeline), routes `pack`, `questions/:qid`, `notes`, jobs `DELETE`, create with `start`, question pushes, tests.
- **W — site UI:** `/trips` guided start + research progress + shapes; `/trips/[id]` decisions rail (questions +
  proposals), proposal cards with preview/nudges/compare, What changed + Undo + versions, brief chips with source
  labels and direct edits, pack browser; option cards finally rendered.
- **P1 — app planning UI:** models + API, `TripQuestionCard`, `TripProposalCard`, `TripChangesCard`, planning home,
  swap/compare sheet with map ghost, start flow + research progress + shape pager, "Tell the planner" bar.
- **P2 — app reach + craft:** notification content extension for question answers, Home tile questions, Share → trip,
  the craft list (radii, sentence case, Dynamic Type, VoiceOver pins, no sheet-on-sheet, ⊞ hub entry, currency),
  Showcase fixtures for every new screen, tests.
