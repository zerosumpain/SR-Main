# The Engine Room — a field study of this site's own architecture

**Status:** in build · autonomous run · 2026-08-05
**Slug:** `/projects/engine-room`
**Kind:** Field study (interactive), same shell as `data-spine` / `policy-engine` / `dfe-data-strategy`

## Brief

> "A walkthrough of the strangeramblings.com site functionality in the same interactive, visual way
> the DfE spine and policy engine work… a lot of intricate, clever functionality baked into this site
> that makes it a brilliant personal knowledge engine… promote it without sharing secrets; focussing
> more on how and why things work, not the secret level information… a tour de force of EVERY SINGLE
> FEATURE."

Named subjects the page **must** cover: jkai and automatic model selection over OpenRouter; the
self-improvement engine; the Hermes integration and its capabilities; caching; RAG; entity
resolution; the jkai toolkit and how its context cost is minimised; MCP; research and the research
canvas table; workflows; the builder; the git deploy process; and how self-improvement and new
functionality move through git, including the safety measures.

## Non-negotiable constraint: no secrets

The page is public and shareable. It must never contain: credentials, API keys or tokens; env var
*values*; personal data of any kind (names, emails, phone numbers); server IP addresses or internal
hostnames; private repository names; or filesystem paths that map the infrastructure. Architectural
description, env var *names*, mechanism, counts and reasoning are all fine — that is the whole point
of the page.

A dedicated adversarial security pass runs over the finished content before it ships.

## Precedents (copied, not invented)

| Element | Copied from |
|---|---|
| Route shell, `.pe-*` helper classes, masthead, sources footer, Ask dock | `projects/data-spine/+layout.svelte` |
| Visibility guard + cache headers | `projects/data-spine/+layout.server.ts` |
| Section tab bar, narrative toggle, mobile burger | `projects/data-spine/components/SectionNav.svelte` |
| Grounded project chat (SSE + BM25 retrieval + rate limit) | `projects/data-spine/chat/+server.ts`, `lib/retrieval.server.ts` |
| Masthead / section header | `components/StoryMasthead.svelte` |
| Flagship staged instrument (SVG grid, rAF playback, live clock) | `projects/data-spine/trace/components/RequestTrace.svelte` |
| Card registration + visibility toggle | `lib/projects/registry.ts` → `STATIC_PROJECT_KEYS`, `projects/+page.svelte` |

Typography and palette follow the field-study standard already in those layouts: Fraunces display,
DM Sans body, JetBrains Mono labels, cream paper / ink / petrol accent from the site tokens.

## Structure

Ten sections plus one flagship instrument.

| # | Route | Covers |
|---|---|---|
| 1 | `/` — **The Machine** | The whole system on one map; what it is and why it exists; the numbers |
| 2 | `/chat` — **Conversation** | jkai hub, Hermes as engine, a turn end to end, streaming, prompt stacks |
| 3 | `/models` — **Models** | Automatic model selection, OpenRouter routing, provider economics, caching, cost |
| 4 | `/tools` — **Tools** | The toolkit, generated inventory, context economics, MCP |
| 5 | `/memory` — **Memory** | Drive + embeddings + RAG, the intel graph, entity resolution, the datastore |
| 6 | `/research` — **Research** | The research canvas, source verification, the anti-fabrication pattern |
| 7 | `/automation` — **Automation** | The workflow engine, the canvas, nodes, triggers, the nightly Doctor |
| 8 | `/building` — **Building** | The autonomous builder; the nightly self-improvement engine and its verify gate |
| 9 | `/shipping` — **Shipping** | Git → CI gate → production, and the safety measures behind it |
| 10 | `/guardrails` — **Guardrails** | The security model end to end (styled as the warning tab, like data-spine governance) |
| ◧ | `/trace` — **Trace a turn** | Flagship: one message followed through every stage and every layer, with a live clock |

## Interactive inventory

Every section carries at least one thing you can *operate*, not just read. Highlights:

- **System map** (index) — the whole architecture as one SVG; hover for what a node is, click to jump.
- **Model router** — pick a task, watch the selection logic resolve to a model and explain itself.
- **Cache ledger** — toggle cache breakpoints and watch the cost of an identical conversation move.
- **Context budget** — a context window as a bar; add tools, prose, history, and see what stops fitting.
- **Entity resolver** — toggle matching signals on two records and watch confidence cross the threshold.
- **Fabrication demo** — the same sources merged two ways; one keeps provenance, one loses it.
- **Fan-in trap** — two branches into one node, and why a merge node does not fix it.
- **Verify gate** — try to get an LLM-authored handler past the static deny-list scan.
- **Turn trace** — the flagship staged instrument.

## Decision log

| Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|
| Page identity | Blog post; single long page; full field study | **Full field study** | The brief explicitly asks for the spine/policy-engine treatment, which is a multi-route shell with instruments | Yes — routes are additive |
| Slug | `how-it-works`, `under-the-hood`, `engine-room` | **`engine-room`** | Short, memorable, matches the "named thing" convention of the other studies (Keystone, The Data Spine) | Costly after sharing; cheap now |
| Section count | 6 broad; 10 focused; 14 granular | **10** | 6 forces unrelated subsystems together; 14 spreads the content too thin per route. 10 gives each route a real argument | Yes |
| Models split from Chat | Fold model routing into Chat | **Separate section** | The brief names automatic model selection and caching as first-class subjects; they drown inside a chat section | Yes |
| Content sourcing | Write from memory; read the code | **Read the code, then adversarially fact-check every number** | A page about engineering rigour that gets its own facts wrong is worse than no page | n/a |
| Ask dock | Omit; reuse global chat; project-scoped RAG | **Project-scoped RAG dock** | It is the recursive demonstration — the page about how retrieval works, answers via retrieval. Called out explicitly in the copy | Yes |
| Visibility at launch | Ship private, toggle later; ship public | **Ship public** | The brief is "so I can share it". Public-by-default needs no visibility row | Yes — one toggle |
| Live data vs static content | Query live subsystems; hardcode verified content | **Hardcoded, verified content** | Live queries would leak private data and couple a public page to internal APIs. Every figure is checked against code at build time instead | Yes |

## Verification

- `npm run gate` (lint + svelte-check + unit tests + build) green.
- `registry-cards.test.ts` passes — the new card key is in `STATIC_PROJECT_KEYS`.
- Adversarial secret-scan pass over all authored content files.
- After CI deploys: fetch every route on the live domain anonymously and confirm 200 + expected
  content, plus a live check of the Ask dock endpoint.
