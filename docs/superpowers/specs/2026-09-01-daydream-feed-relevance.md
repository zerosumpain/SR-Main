# Daydream feed: dates, a summary card, relevance, and two drill-ins

2026-09-01, autonomous run. Six asks, one pass. Sits on top of
`2026-08-31-daydream-editorial-ui.md` (#607) and `2026-08-31-daydream-feed-board.md`
(#609/#612) and must not undo either: colour still comes only from `priority.ts`,
`archived` stays in `PROTECTED_STATUSES`, and the `?tab=` effect stays.

## The asks, verbatim

1. Add a date/time for each of the cards on the feed.
2. Make the cards more of a summary, with a neater on-click detail. Could use a
   modal, to keep the view neat.
3. Each card needs an ability to set the relevance of the point. The model
   should learn to show more relevant items in the feed.
4. The section at the top of every page "waiting on you" with 2 buttons should
   be removed completely.
5. On discoveries, I want to be able to click into the suggestions and see how
   the discoveries are going.
6. I want the memories page cards to be categorised, and for them to highlight
   the key attributes that are being remembered (ie how are these being woven
   into future daydreams?) — is it the specific fact that's remembered, or the
   concept?

## What ships

**1. Absolute stamp.** `ago()` stays (it is the scannable one) and gains a
sibling `stamp()` — `Sun 31 Aug, 14:05`, `Europe/London`, the same timezone
`groupByDay` already pins. Both on the card meta row; the relative one carries
the absolute one as its `title` on narrow screens.

**2. Summary card + modal.** The card face is reduced to: headline, status pill,
a two-line clamped summary, the meta row, the relevance dial, and the quick
actions. Everything that was inside `{#if expanded === t.id}` — root cause,
components table, evidence, the review, the map, the note box, the proposed
actions, the rarer verdicts — moves into an overlay opened by the card title or
the `Open` action. Shell copied from `RelationshipModal` (local portal action,
backdrop click and Escape to close, opaque `--surface-elevated` panel).

**3. Relevance.** New `relevance` (1–5, 3 = neutral) and `relevance_at` on
`daydream_thoughts`. Set from the card face; never touches `status`, so it
collides with neither `PROTECTED_STATUSES` nor the `archived` rule, and
`persistCandidates` (which sets neither column) preserves it across
re-detection. It feeds the learned per-kind and per-context weights through the
same currency feedback already uses, so a kind John keeps marking relevant
scores higher on the next detect pass and clears the delivery bar more often.
The feed gains a `Relevance` order chip, and the modal shows the kind's current
multiplier so the loop is visible rather than asserted.

**4. Removal.** The `Waiting on you` band, `attention`, `AttentionCard`,
`attentionHeadline`, `jumpTo` and `.band.attn` all go. The counts it was built
from stay — they are also the tab-rail badges.

**5. Lead drill-in.** A `Progress` button per line of enquiry opens a full-width
row carrying that lead's trace (`daydream_lead_steps`, round by round: plan,
spawn, read, judge, prune, with tokens), its named score components, and the
questions it owns — derived the way `statsFor` derives them, from the metric
allow-list, so a lead cannot claim a question that is not inside its own range.

**6. Memories, categorised.** The Memory tab gains a room above the rulings:
every live `jkai_memories` row, grouped by category, with a facet bar. Each card
says where it came from (a ruling, a note John typed, a place he named,
elsewhere in jkai) and — the half he actually asked about — exactly how it is
used: carded verbatim into every ponder pack as `Known (<category>): <sentence>`,
and, for a refutation, repeated in the hard block that tells the proposer never
to raise it again. The answer to "fact or concept" is stated on the page: the
specific sentence, verbatim, never generalised.

## Decision Log

| Fork | Options | Chosen | Why | Reversible |
|---|---|---|---|---|
| Relevance scale | thumbs (dupes feedback) · 1–5 · −2..+2 | **1–5, 3 neutral** | Reads as a dial rather than a second verdict, and the midpoint gives "I looked and it is ordinary" a home, which a thumb pair cannot express. | Column, one migration |
| Where relevance acts | global threshold · per-kind weight · display sort only | **per-kind + per-context weight, plus a sort chip** | The threshold measures whether an *interruption* landed; relevance is about the topic. Folding it into the weight is what makes future items rank higher — display-only would have been theatre. | Pure function, revertible |
| Relevance provenance weight | 1.0 (as strong as an explicit verdict) · 0.8 · 0.5 | **0.8** | Explicit and considered, but available on rows that never reached him, so it should not outrank a verdict on something he actually saw. | Constant |
| Modal as a component vs inline | new `.svelte` · inline in the page | **inline, with a local portal action** | The detail reads 12 pieces of page state and 7 handlers; a component means prop-drilling all of them for no reuse. The existing `.detail` CSS keeps working untouched. | Extractable later |
| Card summary source | `explanation` · `narrative` · new column | **existing text, two-line clamp** | No new column, no model call, and the full text is one click away in the modal. | CSS |
| Lead drill-in placement | new route · expanding row | **expanding row** | Same shape as the hypothesis drill-through already on that tab (`toggleHypDetail`), and it keeps the comparison against the other leads on screen. | Local |
| Memory source | rulings only (today) · `jkai_memories` live rows | **`jkai_memories`, joined back to thoughts for origin** | He asked what is *remembered*, and the store the engine reads back is that table — rulings are one writer of it, not the whole of it. | Additive |
| The arbitrary 16 | leave · order the snapshot read | **order by `created_at desc`** | `pack.ts` takes `slice(0, 16)` of a 200-row read with no ORDER BY, so which memories reach a pack was luck. The page now states which 16, and the statement has to be true. | One clause |
