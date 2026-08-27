# The intel mail gate

**Shipped 2026-08-27.** Email no longer feeds the knowledge graph automatically.
It is captured, held, and admitted by exception — one thread, one cluster, or one
approved rule at a time.

## Why

The nightly sweep read the whole mailbox into the graph, and it worked exactly as
designed. Measured on production the morning this was written:

| | |
|---|---|
| intel notes from email | 2,781 of 3,116 (89%) |
| live entities asserted by an email note **alone** | 8,974 of 13,469 (67%) |
| relationships sourced from an email note | 11,458 of 16,727 (69%) |
| most common relationship type in the whole graph | `offers`, 1,368 edges |

`offers` beat `collaborates_with`, `works_on` and `stakeholder_in` combined. A
random sample of entities whose only evidence was bulk mail: *"5% savings
ending"*, *"Summer body"*, *"Christmas bauble"*, *"Order #204-3656435-0740303"*.

The existing `emailKind` facet could not fix it: **933 of those 1,368 `offers`
edges came from mail classified as `correspondence`**, because a brand that mails
from an ordinary domain is indistinguishable from a colleague by its address
alone.

## The one distinction the whole design rests on

A **note** and the **graph rows read out of it** used to be the same decision.
They are now separate, because daydreaming reads `intel_notes WHERE source =
'email'` directly in three places:

- `daydream/offers.ts` — bulk subjects and bodies → voucher extraction
- `daydream/spend/read.ts` — receipt extraction
- `daydream/snapshot.ts` — note titles → interest terms

So the notes **always stay**. `intel_notes.graph_state` is the gate:

- `admitted` — extracted; its entities and edges are in the graph. Default, so
  every non-email source behaves exactly as before.
- `pending` — stored, embedded, searchable in the queue. Never extracted. Costs
  one embedding and no model call.
- `rejected` — refused. Never extracted, never re-queued, and the sweep will not
  ask again.

## Shape

```
sweep (gated)          →  note written, embedded, graph_state='pending'.  No LLM.
   ↓
/jkai/intel/mail       →  suggestions · clusters · all threads · rules
   ↓ owner or rule
admitMailNotes()       →  header edges + body extraction + attachments→/drive
                          + body/attachment text → mail_embeddings
```

- **Purge** — `mail-purge.ts`, set-based, one transaction, dry-run first.
  Preserves `manual` relationships and entities the owner **watched, lensed or
  filed in a dossier**. See the gotcha on `confirmed` below.
- **Clusters** — sender domain, and subject family within a sender
  (`subjectFamily` strips order numbers, so 200 shipping notices are one
  decision). Topic-by-embedding is on demand (`similarPending`), not up front.
- **Rules** — data, never code. A closed expression tree over the ten scalar
  facts in `mail-facts.ts`, interpreted by `mail-rules/evaluate.ts`. Copied from
  the daydream rules engine (#473), which is the shipped precedent.
- **RAG** — `mail_embeddings` mirrors `file_embeddings` in the same vector space
  (`text-embedding-3-small`, 1536-dim). Attachment **bytes** go into /drive under
  `mail/`, which gets previews, citations and the `@files` index for free; the
  folder is created `intelMode: 'exclude'` so a document cannot reach the graph
  through a second door. Tools: `mail_search`, `mail_read`.

## What cannot happen, and where that is enforced

| Promise | Enforced by |
|---|---|
| A model cannot admit an email | `validateRule` refuses `status: 'active'`; `proposeRule` forces `'proposed'`; only `activateRule` — owner-authenticated — sets `active` |
| A bad rule cannot be offered | `judgeBacktest`: >33% of the mailbox, >50/week, or >2 threads the owner had rejected → refused |
| A rule cannot mark its own homework | Backtests read `ownerDecisions()` only; rule admissions record `actor: 'rule'` |
| A rule cannot read your mail | Ten scalar facts. No body, no address, no subject text |
| Held mail cannot leak into an answer | `graph_state = 'admitted'` in `searchIntel`, `recall.ts` and `context.ts`; only admitted threads are ever indexed |
| A purge cannot break daydream | It never deletes a note. Covered by `mail-purge.integration.test.ts` |

## Cost

The nightly 150-call extraction budget is no longer spent on the mailbox. A
gated sweep costs one embedding per newly-changed thread (~$0.00002). Model calls
are spent only on threads somebody asked for.

## Gotchas found on the way

- **837 of the 2,781 notes are header-only stubs** written by
  `persistStructuralOnly`, averaging 124 characters. They carry **no
  `contentHash`**, so the first gated sweep re-reads and captures them properly.
  Until then the queue marks them "not yet captured"; admission re-fetches from
  Gmail either way.
- **Attachment presence had to be recorded at sweep time** (`attachmentCount` in
  metadata). A gated sweep never downloads an attachment, so the old
  `--- filename ---` text marker reports every held thread as having none — which
  would have made `hasAttachments` false across the entire backtest corpus.
- **`twoWay` counts senders, not participants.** A mailshot to fifty people has
  fifty participants and one sender; counting participants would admit every
  newsletter in the mailbox.
- **`confirmed` is not a human verdict.** It reads like one, and honouring it in
  the purge would have preserved 5,875 of the 8,974 junk entities — a two-thirds
  reset dressed as a total one. `graph.ts:308` sets it automatically on any
  re-assertion at high confidence, and `structuralEdges` asserts every email
  participant at high confidence. Measured before the first run: of those 8,974
  entities, 5,875 were `confirmed` and **zero** were watched, lensed or filed.
  The real owner signals are `watched`, `lens` and dossier membership.
- **The `from` field must stop at the `·` separator.** `sendersIn` originally
  matched `from\s+[^<\n]*<(…)>`, and on a line like
  `[1] · from service@paypal.co.uk · to John Kelly <me@gmail.com>` that runs
  straight past the bare sender and captures the RECIPIENT. Every transactional
  email where the sender has no display name and the owner does was read as a
  message the owner had sent — `ownerReplied` and `twoWay` both true. The seed
  rule's first backtest offered PayPal receipts as two-way correspondence, which
  is how it was caught. **The gate is what made this safe: the rule sat at
  `proposed` with its samples on screen, and nothing was admitted.**
- **A third of the queue had no sender.** `senderDomain` and `emailKind` are
  written at ingest by `emailFacets`, and `persistStructuralOnly` builds its own
  metadata with no classifier step — so all 837 stubs plus a couple of hundred
  others (1,043 of 2,857, 37%) collapsed into one cluster called "unknown".
  `factsFor` now falls back to `classifyEmail` over the stored participants.
  Domain rules are not applied in the fallback (they need a database), so a
  stored verdict always wins.
- **The rolling sweep will not recapture the old stubs.** Its query is
  `newer_than:84d` capped at 2,000 threads, and the stubs sit beyond that. They
  stay header-only and the queue marks them `captured: false` — admission
  re-reads them from Gmail by thread id, which is unaffected by the window.
- **`perWeek` divides by the corpus's real span.** A rule replayed over eleven
  days and reported "per week" without dividing overstates itself twofold, and
  every threshold downstream then means nothing.

## Running any of this against production

The purge, the sweep and the rules are all owner-gated routes, so the way to run
them without a browser session is to import the deployed chunk (see
`reference_running_deployed_chunks_on_vps`). Two things that bit during rollout:

- **Set `JKAI_SERVICE_ROLE=builder`.** Importing almost any server chunk boots
  the platform services, including a second Baileys client — and a duplicate
  WhatsApp client can log the VPS session out. That role owns nothing. Do **not**
  reach for `JKAI_BUILDER_PROCESS=1` instead: it *also* turns off
  `isAutoExtractEnabled()`, so `extractIntoIntel` returns `disabled` and the
  sweep silently writes no notes at all.
- **Pick the chunk by what it EXPORTS, not by what it mentions.** A content
  search for `ROLLING_GMAIL_INTEL_QUERY` matches the route chunk too, which
  re-exports only `GET`/`POST`. And the private-env chunk exports two functions,
  `b` and `s` — `s` is `set_private_env`; taking "the first function" gets `b`
  and leaves `DATABASE_URL` undefined behind a misleading SASL error.

## Rollout, 2026-08-27

Backup: `~/backups/intel-pre-mail-gate-20260827.sql.gz` (111 MB) on the VPS.

| | before | after |
|---|---|---|
| live entities | 13,469 | **4,495** |
| relationships | 16,727 | **5,234** |
| email-derived graph rows | 11,458 | **0** |
| most common relationship | `offers` (1,368) | `uses` (367) |
| email notes | 2,781 | 2,781, all `pending` |

Daydream verified unaffected after the purge: `offers.ts` sees 899 bulk threads
in its 45-day window, `spend/read.ts` sees all 2,781, `snapshot.ts` sees 2,138
interest terms, and every body is intact.
