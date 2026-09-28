# Daydream UX — from a wall of notes to a guided decision flow

John, 2026-09-28: daydream can now carry a note all the way to action
(commission → Workflows → notification → backlog/build), but the UI is
"atrocious". Wanted: plain-English description of each opportunity, process-driven
guidance that onboards the reader, visuals that make the options clear, a
dashboard of change over time and how effectiveness is measured, and a clean
sign-off. The iPhone app should feel the same. Autonomous, deploy when done.

## What was wrong (measured on the live page, 57 notes)

- Every note is the same card with **six equal-weight buttons** (Investigate first ·
  Useful · Not useful · Never this kind · Add a note · Open). No hierarchy, no
  sense of which is the decision.
- "Investigate first", "evidence refresh", "Scope of approval", "Workflow worker",
  SHA-256 receipts — engine vocabulary on the owner's surface.
- "What it read" prints raw tool calls: `ha_find({"query":"","domain":["lock"…`.
- The suggested action is buried as a `Next:` paragraph inside the body.
- Improvements sit in a separate panel above the feed, detached from the note that
  started them. Nothing shows where a note is in its journey.
- No measure of whether any of it is working over time: one "Useful, 30 days" tile.

## The model the UI teaches — four stages

| Stage | Plain words | What moves it |
|---|---|---|
| 1 Spotted | jkai noticed something and wrote it down, citing what it read | the think loop |
| 2 Your call | you decide: worth knowing · check the facts · not for me | owner |
| 3 In motion | an approved check runs; a build idea waits in the build queue | Workflows / backlog |
| 4 Result | the report is back, or the build shipped; your verdict is the score | owner + system |

Every surface — the cover, each card's mini track, the filters, the phone — uses
these four words.

## Design

**Web `/jkai/daydreams` (Inbox)**
- Cover copy rewritten in plain English; deck tiles = the pipeline (To decide · In
  motion · Done this month · Hit rate).
- `HowItWorks`: a four-step stepper with live counts. Expanded on first visit with a
  sentence per step; "Got it" collapses it to a one-line track (per-browser, via
  localStorage — a convenience, not state).
- Segments: **To decide · In motion · Done · All**, default To decide.
- `OpportunityCard`: area glyph + area · kind pill · time; title; *What it found*
  (first paragraph); **Suggested next step** box (the `Next:` line, split out);
  *How it knows* — humanised sources ("Bank spend · Canva · 60 days"); a four-dot
  stage track. Decision row: three labelled choices with a one-line consequence
  each — **Worth knowing**, **Check the facts** (only when the note has
  replayable private sources and commissioning is on), **Not for me**; overflow
  holds *Never this kind* and *Add a note*. Build ideas show their build-queue
  status with a link.
- `SignOff` (replaces `CommissionPanel`, rendered inside the card that started it):
  "Double-check this" sheet — *What will happen* (humanised reads), *What won't
  happen*, *Limits*, *You'll know it worked when* — then Approve & run / Not now
  / Decline. A progress track (Proposed → Approved → Checking → Report ready), the
  report with humanised sources, receipt hashes folded away, history folded away.

**Web `/jkai/daydreams/impact` (new room)**
- KPI deck: hit rate last 28 days vs the 28 before (delta), notes, decided share,
  median time to decide, acted on.
- Weekly stacked bars, 12 weeks: useful / not useful / undecided, with the
  new-loop start (25 Sep) marked — old engine vs question-led loop is visible.
- Hit rate by area (channel) and by kind — bars with n, so a 1-of-1 is legible as
  such.
- Funnel: Spotted → Decided → Worth knowing → Acted on → Result.
- "How this is measured" — the definitions, in plain words.
- Recent results: completed checks and shipped build ideas.

**Server**
- `think/explain.ts` (pure): `splitNarrative`, `describeSources` (tool card → plain
  label), `noteStage`.
- `impact.ts` (pure aggregator) + `impact.server.ts` (reads).
- `FeedNote` gains `summary`, `next`, `sources`, `checkable`, `stage`.
- `/api/native/daydream` gains optional note fields and top-level `pipeline` +
  `impact`. Additive: the existing wire is unchanged, old app builds ignore them.
- Commission spec copy rewritten in plain English (new proposals only; the hash
  covers the spec, so an existing proposal keeps its approved text).
- Think prompt: statistics must be said in words first.

**iPhone (SR-AppleApp)**, on top of #82 (commissioning):
- Daydream screen: pipeline header with counts, segmented To decide / In motion /
  Done, the same card anatomy (next-step box, sources, three choices), an Impact
  card (hit rate, delta, 12-week bars), sign-off sheet rewritten with the same
  plain-English sections and a progress track. Today tile says "N to decide".

## Decision Log

1. **Rooms vs in-page segments for the flow** — options: new routes per stage /
   in-page segments. Chose segments: one list, instant switching, `?note=` and
   `?commission=` deep links keep working unchanged. Reversible.
2. **Impact as its own room** — options: section at the foot of the Inbox / own
   route. Chose a route: it has its own reads (84 days, all engines) and the Inbox
   stays fast. Reversible.
3. **Include pre-think (legacy engine) notes in Impact** — yes, labelled: it is the
   only baseline that shows whether the 25 Sep simplification improved anything.
   The new loop's line starts where it started.
4. **"Acted on"** = a check approved, or a build idea accepted in the backlog. "Result"
   = check report ready, or backlog item shipped. Defined on the page.
5. **Onboarding persistence** — localStorage, not a DB setting: it is a per-browser
   convenience and must render correctly without it.
6. **Don't change the model's output contract** (title/body/action). Split `Next:`
   in code; only nudge the prompt on statistics. Lowest-risk way to get plain English
   without destabilising the audit.
7. **iOS PR #82** — build on it rather than beside it; merge it first once its macOS
   job is green (it was the tested slice John asked to go live).
8. **Wire additions are optional keys** — the fixed `NativeNote` contract is extended,
   not changed.
