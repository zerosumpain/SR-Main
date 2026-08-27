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
  Preserves `manual` relationships and `confirmed` entities: a purge of machine
  extraction must not destroy the owner's own decisions.
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
- **`perWeek` divides by the corpus's real span.** A rule replayed over eleven
  days and reported "per week" without dividing overstates itself twofold, and
  every threshold downstream then means nothing.
