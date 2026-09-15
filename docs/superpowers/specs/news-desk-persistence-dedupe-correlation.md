# News desk — persistence, deduplication, and graph correlation

Status: in progress
Started: 2026-09-15

A review of `/news` produced ten improvements. This spec covers all of them,
shipped in four phases. The order is John's: 1, 3, 7 first, then the remainder
in numeric order.

## The problem the review found

`/news` fetches three wires live on every page load, interleaves them, caches
the result in an in-process `Map` for three minutes, and throws it away. The
only news table is `news_favourites`.

**Nothing records what was on the desk yesterday, what was opened, or what was
skipped.** That single fact blocks most of the list: "new since you last
looked", trend detection, recommendation, and any measurement of whether a
change made the desk better all need a yesterday to compare against.

Three defects follow directly from it, and a fourth from the schema:

- `newSinceLast` (`sources.ts:337`) diffs against the previous *cached fetch* —
  about three minutes old, same process, same `view:limit` key. It resets to
  zero on every deploy, changes meaning when the limit changes, and has never
  once meant "since you last looked", which is how the tile presents it.
- `interleave()` (`sources.ts:275`) dedupes nothing across wires. A story on
  both Hacker News and Lobsters takes two of twenty-five slots and splits its
  own signal.
- Ars Technica is hardcoded `score: 0` (RSS has no votes), and both the `best`
  view and the Points sort order by raw score, so Ars can never rank above any
  HN or Lobsters story. The UI calls this "Unscored".
- Adding a source is a code change by design (`constants/news-sources.ts:17`),
  and the duplication has already started: `isNewsSource` hand-codes the three
  names, and `+page.server.ts:33` hand-builds a literal triple of source states
  for the favourites view that will under-report the moment a fourth exists.

## Phases

**A (this PR) — items 1, 3, 7.** Persist the wire; deduplicate across sources;
correlate stories against the knowledge graph.

**B — items 2, 4.** Honest `newSinceLast` from persistence; per-source
normalised heat so a scoreless wire ranks fairly.

**C — items 5, 6.** Sources become rows; add the public-sector lane.

**D — items 8, 9, 10 + cleanups.** "For you" view; "you already know about
this"; a `news-brief` heartbeat activity; unify the two search implementations
and remove the hardcoded source triple.

## Phase A design

### 1. Persistence

Two tables. Both are wire facts, not owner opinions, except `news_reads`.

- `news_stories` — one row per `newsKey`, upserted on every real gather.
  `firstSeenAt` never moves; `lastSeenAt`, `score` and `commentCount` take the
  high-water mark, because a story's score only goes up while it is on a front
  page and we want its peak, not whatever it happened to be at the last poll.
  Carries `canonicalUrl` so phase A's dedupe has an index to group on.
- `news_reads` — `(ownerKey, newsKey)` with `readAt` and `readCount`. Written
  from the reader page load, which is the only place a story is actually read.

Writes are fire-and-forget from `loadFeed`, never awaited on the request path: a
news desk that 500s because a logging insert failed is a worse desk than one
with a gap in its history.

The desk's per-owner last-visit timestamp does **not** get a table. It is one
scalar per owner and goes in `app_settings` via `getSetting`/`setSetting`, the
same way the watchlist snapshot does.

### 3. Deduplication

`canonicalUrl()` lowercases the host, strips `www.`, drops the fragment and the
known tracking parameters (`utm_*`, `ref`, `fbclid`, `gclid`, `mc_cid`, …),
sorts what remains, and trims the trailing slash.

After interleaving, stories are grouped on that key. The first occurrence in
interleave order wins the row — that preserves the existing ranking — and the
others become `alsoOn` entries carrying their own source, discussion URL, score
and comment count. Comment counts sum; score takes the max.

**A story that made two front pages is a stronger signal, not a duplicate.** The
row says so rather than hiding one of them.

### 7. Correlation against the knowledge graph

An uncommitted module from an earlier session (`correlate.ts`,
`correlate.server.ts`, 19 tests) already does this and was calibrated against
the live wire on 2026-09-02. It is adopted rather than rewritten.

Shape: `correlate.ts` is pure maths — anchors in, stories in, ranked matches
out, no `$lib/db`. `correlate.server.ts` builds anchors from entities (degree,
with a lift for `watched` and `confirmed`), completed research sessions, and
recent memories. Matching is lexical with three strengths — phrase, name,
acronym — each with its own floor, because a multi-word name in a headline is
near proof while an acronym is a coincidence generator.

One guard is added to the adopted code, from the review: **an entity whose only
evidence is a news-derived note cannot be an anchor.** `keepNewsInGraph` writes
intel notes carrying `metadata.newsKey`, which mint entities; without the guard,
keeping a story makes the next similar story look relevant, and the graph
teaches itself to recommend what it already recommended. This is the same
feedback loop the mail relevance work hit, one hop away.

## Decision Log

**Adopt the uncommitted `correlate.ts` rather than reuse `mail-relevance.ts`.**
The review recommended reusing the mail primitives (`buildSurfaceIndex`,
`matchEntities`). Having read both: mail-relevance is built around a
document-frequency guard over a mail corpus and stores its scores on note
metadata, neither of which fits a 50-headline wire refreshed every three
minutes. `correlate.ts` is purpose-built for headlines, is pure, and is already
calibrated and tested. Reversible — the modules are independent, and the anchor
loader could be swapped for `loadAnchoredEntities` later without touching the
matcher.

**Score/comment high-water marks rather than last-observed values.** A story
polled after it falls off the front page reports a lower comment count than its
peak. Storing the max makes "how big did this get" answerable; storing the last
value answers nothing. Irreversible only in the sense that history not captured
cannot be recovered, which argues for the max.

**Dedupe keeps the first occurrence in interleave order, not the highest
score.** Keeping the highest score would silently re-rank the desk as a side
effect of a deduplication change, and phase B is where ranking is meant to
change. Reversible — one comparator.

**Last-visit in `app_settings`, not a table.** One scalar per owner. The ship
skill prefers no schema change where the datastore or settings will do, and
`app_settings` is what the watchlist snapshot already uses. Reversible.

**Fire-and-forget persistence.** The alternative — awaiting the upsert — couples
the desk's availability to a write that nothing reads synchronously. Gaps in
history are recoverable; a 500 on the reading desk is what the user sees.
Reversible.

**Four PRs rather than one.** Each phase is independently useful and
independently verifiable on production, and a single 10-item PR would take the
whole thing red on one bad test. Costs four CI cycles.
