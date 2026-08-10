# Studio research modes — build from what is already known

**Date:** 2026-08-10
**Status:** spec, self-approved (autonomous build)
**Follows:** `2026-08-10-jkai-studio-explainer-builds-design.md`

## Problem

`buildResearchBrief` always creates a new Deep Dive session and waits for it. That is correct
for a topic nobody has researched and wasteful for one already covered: the first real studio
build spent 20 minutes re-researching before dying on a timeout, while the database already
held 4,088 facts.

Measured on production, 2026-08-10:

| facts | embedded | sessions | sources | distinct URLs |
|---|---|---|---|---|
| 4,088 | 4,058 (99.3%) | 19 | 1,012 | 975 |

A real corpus, already embedded, already sourced — and the brief builder never looked at it.

## Approach

A `researchMode` on the build. Three values, and the work is almost entirely in choosing
where `orderedFacts` comes from — everything downstream is unchanged.

| Mode | Behaviour |
|---|---|
| `reuse` | Search the existing corpus only. No new session. Seconds, no cost. Fails with a clear reason if the corpus cannot clear the bars. |
| `extend` (**default**) | Search first. Clear the bars → plan immediately. Fall short → start a Deep Dive **seeded** with what was found, so it researches the gaps. |
| `fresh` | Today's behaviour — always a new session. |

`extend` is the default because it is strictly better than today on both axes: fast when the
knowledge exists, identical when it does not.

### The reuse path

`searchResearch(challenge, { topK, minSim })` in `src/lib/deepdive/research-search.ts` is the
precedent and the whole engine. It already does semantic search across **all** sessions and
returns exactly the shape the brief needs:

- `passage` → the claim
- `sourceUrl` → **already sanitised to http(s) or null** by that module
- `sourceTitle` → the detail line
- `score`, `confidence`, `sessionId`, `sessionTopic`

It is the same primitive behind `@research` in chat. It also already filters to
non-counterfactual, embedded facts only — the same discipline the fresh path applies by hand.

Reuse hits are mapped into the identical `orderedFacts` shape and handed to the **same**
conversion call. Facts and their URLs still never pass through a model; only the synthesis
(concepts, causal map, misconceptions, gaps) does. `isBriefUsable` is unchanged and still the
gate.

### The seeding path

When `extend` falls short, the new session is created with `seedContext` — the existing
`SeedContext` type, already consumed by `phase1.ts`, which folds `parentTopic`,
`factContents` and `entityNames` into the researcher's system prompt. `research_branch` is
the working precedent. `parentSessionId` stays null: reuse hits span several sessions, so
there is no single parent, and the column means one specific parent elsewhere.

## Where the knowledge graph fits

Deliberately narrow. `entities` / `globalEntities` / `globalEntityLinks` carry names and
session links but **no sourced claim text with a URL** — that lives only in `fact` ⋈ `source`.
Using the graph as a fact source would mean inventing provenance, which is precisely the
defect the previous spec's fix wave removed.

So the graph's role here is **selection, not evidence**: `findRelatedSessions` in
`cross-session.ts` answers "which sessions already know about this entity", which can narrow
a search. Not implemented in this pass — `searchResearch` already searches everything, so
narrowing is an optimisation, not a capability. Recorded so the reasoning is not relitigated.

`intel_notes` (the Intel centre's Gmail/Drive-derived store) has a different provenance shape
and is out of scope.

## Files to touch

**Modify**

| File | Change |
|---|---|
| `src/lib/db/schema.ts` | `researchMode` text column on `jkai_builds`, default `'extend'` |
| `src/lib/jkai/research-brief.ts` | mode branch, `factsFromExistingKnowledge`, seeding |
| `src/lib/jkai/research-brief.test.ts` | mode selection, dedup, host-diversity, mapping |
| `src/lib/jkai/studio.ts` | accept + persist `researchMode` |
| `src/routes/api/jkai/studio/+server.ts` | accept + validate `researchMode` |
| `src/lib/workflows/site-tools/tools/studio.ts` | expose `researchMode` |
| `src/routes/jkai/builds/new/+page.svelte` | mode selector on the Studio panel |
| `src/lib/jkai/orchestrator.ts` | pass the build's mode into `buildResearchBrief` |

Eight files, all small, no new subsystem.

## Verification

Stated before writing code.

- `npx vitest run src/lib/jkai/research-brief.test.ts` — pure tests for mapping, dedup,
  host-diversity and mode selection.
- **The one that matters:** a scratch script running `searchResearch` against the real
  production corpus for a topic already covered by an existing session, proving reuse yields
  ≥8 facts from ≥3 distinct hosts — i.e. that `reuse` can actually clear `isBriefUsable`.
  If it cannot, the feature is theatre and the default must stay `fresh`.
- `npm run gate`, then a live studio build in `extend` mode on a covered topic, confirming
  the build reaches planning without creating a new research session.

## Decision Log

| Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|
| Default mode | fresh / reuse / extend | **extend** | Strictly better than today on both axes; never worse. | Yes — one default |
| Graph as fact source | yes / selection only / ignore | **selection only, not implemented yet** | The graph has no per-claim URLs; using it as evidence would fabricate provenance. | Yes |
| `parentSessionId` on seeded sessions | set to best hit / leave null | **null** | Reuse hits span sessions; the column means one specific parent. `seedContext` carries the multi-source context. | Yes |
| Reuse fact cap | same 15 as fresh | **15** | Keeps the brief a constant size regardless of path, so prompts stay comparable. | Yes |
| `minSim` for reuse | 0.3 (module default) / higher | **0.45** | 0.3 is tuned for chat recall where a human filters; a brief's facts are rendered as truth, so precision matters more than recall. | Yes — one const |
