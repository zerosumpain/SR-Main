# Daydream delivery and briefing — P3 of the 2026-09-02 overhaul

Autonomous build. Brief: John's asks (5) "briefing should be the daily vehicle
for summarising all daydreams per day" and (6) "balance of whatsapp needs
review — what gets sent vs what doesn't linked to relevance". Items 6.1–6.5
and 5.1–5.4; decision D6(a) as recommended.

## What was measured (production, 2026-09-02)

- `chooseChannel` accepted `opts.threshold` and deliberately never read it:
  verified was the only test, then the caps. Relevance never reached the
  channel decision. Routes were a three-entry constant. Ever sent: musings
  14, graph links 5, patterns 2, security 1.
- Two daily summaries: the digest (rich, seen by nobody) and the briefing's
  Daydreams section (24h, two titles and two counts, in WhatsApp only if the
  model chose to quote it). `/jkai/briefing` was a redirect to a tab.

## Design

### 6.1 The gate reads all three instruments

`chooseChannel` takes `kindWeight` (the multiplier `persistCandidates` stored
in `components.kindWeight`) and READS the threshold again. WhatsApp only if
verified AND `score ≥ threshold` AND `kindWeight ≥ 1` (neutral). Anything
verified that fails the policy is held as `briefing_only`, which the next
morning's briefing reads back. The caps stand unchanged.

### 6.2 Routes as a setting

`routes.ts`: `DEFAULT_ROUTES` by family and by kind; `routeFor(kind,
overrides)` (kind beats family); `ROUTE_OPTIONS = whatsapp | briefing |
feed`. Defaults: `mail_security → whatsapp`; musings → whatsapp (the 6.1
policy applies); graph, places, patterns, rules → briefing; the other mail
lanes → feed. Overrides live in `app_settings['daydream.routes']`, edited on
the Engine room's routes grid through the `set_route` action. `FEED_ONLY_KINDS`
survives as the derived list of default feed routes.

### 6.3 Relevance moves the cooldown

`cooldownHoursFor(meanRelevance)`: 5 → 8h, 4 → 14h, neutral or unrated → 20h,
2 → 32h, 1 → 48h. `daydream-compose` groups the relevance rows by kind once
per tick and passes the means in.

### 6.4 Replies rate relevance

`wa-feedback.ts` gains a second closed list: `matters` / `this matters` /
`worth my attention` → 4; `really matters` / `what I care about` → 5;
`doesn't matter` / `not my concern` → 1; `marginal` → 2; `rate N` / `N/5` →
N. Bare digits are NOT accepted — an approval reply could be a digit. `why` /
`why?` answers with the evidence lines of the last delivered thought. Useful
and not-useful stay as feedback.

### 6.5 The delivery cell

`loadDeliveryStats()`: sent today against the cap, sent in 7 days, held by
reason today and in 7 days, the next free slot (min gap, cap, quiet hours),
rendered as a `RollupGrid` on the Engine room beside the routes grid.

### 5.1 One daily summary

`$lib/daydream/briefing.ts` — `buildDaydreamBriefing(now)` — assembles the
Daydreams section from the ledger for the last local day: sent, held for the
briefing (`briefing_only`), refuted with the reviewer's one line, applied
graph links, places named, expired, plus the digest's hypothesis and lead
counts, and the memory themes made. Deterministic. `briefing-compose` calls
it instead of its own three queries, and every fact carries an `href` into
the hub.

### 5.2 A day page

`/jkai/daydreams/briefing/[day]`: one briefing record, opening on a rollup
(sections × facts, gaps, sources), then each section's facts as a `FactList`
with links, then the message as sent. The briefing room gains a day strip and
each row links to its day.

### 5.3 A fixed WhatsApp slot

`briefing-compose` emits `daydreamsText` (≤ 8 lines). The workflow's "Build
record + message" transform appends it under a 💭 heading and points the
detail link at the day page. The rebuild SQL is updated and the live node's
config is updated on production after deploy (the SQL is the reproducible
source; the canvas node is its deployment).

### 5.4 BriefingPanel on the system

The briefing view is rebuilt on `SectionHead` / `StatDeck` / `RollupGrid` /
`FactList`; the source-profile configuration view is kept as it is.

## Verification

- Unit: `routeFor`, `cooldownHoursFor`, `chooseChannel` policy cases,
  `matchRelevanceReply`, `buildDaydreamBriefing` text shape.
- porkserv gate with build; five lint gates; screenshots of the Engine room
  (routes grid, delivery cell), the briefing room and a day page.
- Live: the next `daydream-compose` pulse names `briefing_only` holds; the
  next 07:00 briefing carries the 💭 block; `/jkai/daydreams/briefing/<date>`
  answers.

## Decision Log

| # | fork | chosen | why | reversible |
|---|---|---|---|---|
| 1 | bare digit replies for relevance | refused | an approval reply may be a digit; `rate 4` and the phrase list are unambiguous | yes |
| 2 | kindWeight from the stored components vs recomputed at delivery | stored | it is the number the feed prints and the score was built with; recomputing risks two weights for one row | yes |
| 3 | routes keyed by family AND kind | both, kind wins | a family default with one exception (security inside mail) is the common case | yes |
| 4 | the WhatsApp block appended by the transform vs by the model | transform, verbatim | the model quoted the section only when it chose to; a summary the vehicle may drop is not a vehicle | yes |
| 5 | Discoveries §E digests | left in place | it is the archive of the digest rows the briefing now reads; removing it is a separate tidy | yes |
| 6 | live canvas node edit | by SQL, after deploy, from the rebuild file | the rebuild file is the reproducible source and has always been applied by hand | yes |
