# Spec — `@research` reference RAG in jkai chat

**Date:** 2026-07-06
**Grade:** Full autonomous (kick-off: "do it autonomously and let me know what you've pushed to prod at the end")

## Goal

Give jkai chat an `@research` mention that mirrors the existing `@files` mention:
when John writes `@research`, the orchestrator semantically searches the **materials
of his deep-dive research sessions** (the extracted `fact` rows, already embedded) and
grounds its answer in the retrieved passages, rendering clickable "sources" chips.

`@files` already does this for `/drive` files via the `file_search` tool over
`file_embeddings`. `@research` is the same shape over the research subsystem's
`fact.embedding` (pgvector, 1536-dim, `text-embedding-3-small` — identical embedder).

## Precedents (copied, not invented)

- `src/lib/file-index/search.ts` — `searchFiles()` pgvector cosine retrieval → mirror as `searchResearch()`.
- `src/routes/api/deepdive/[id]/chat/+server.ts` — per-session fact retrieval (`1 - (embedding <=> v)`), the exact SQL shape, generalised to cross-session.
- `src/lib/workflows/site-tools/tools/files.ts` (`file_search`) — the tool shape → mirror as `research_search`.
- `src/lib/components/jkai/FileReferenceChips.svelte` → mirror as `ResearchReferenceChips.svelte`.
- `chat/+server.ts` `turnFileRefs` promotion + `ChatArea.svelte` `@files` mention/routing/hydration → mirror for research.
- `~/.hermes-jkai/skills/jkai-files/SKILL.md` `@files` section → mirror in `jkai-research/SKILL.md`.

## Data reality (verified)

- Prod DB: 3,709 facts, **803 embedded**, across **18 sessions** → real materials to search.
- Local dev DB: 0 facts → cross-session retrieval tested against a seeded synthetic fact + real embedding.
- `fact.embedding` is populated by the research worker; `generateEmbedding` (deepdive/ai) uses the same `text-embedding-3-small` model that wrote them → query/index dims agree.

## Files to touch

1. **NEW** `src/lib/deepdive/research-search.ts` — `searchResearch(query, {topK,minSim,sessionId})`: cross-session cosine retrieval over `fact.embedding`, joined to `research_session` (topic) + `source` (title/url/domain). Skips counterfactuals + null embeddings.
2. **NEW** `src/lib/deepdive/research-search.test.ts` — guards (empty query, NaN topK, vector-literal safety) + hit-mapping.
3. `src/lib/workflows/site-tools/tools/research.ts` — add `research_search` tool (toolset `research`), ends its description with "When the user writes `@research`, use this tool."
4. `src/routes/api/workflows/orchestrator/chat/+server.ts` — `turnResearchRefs` promotion (detect `research_search`/`jkai_extended` hits by `factId`+`sessionId`), emit on `done` as `researchRefs`, persist in assistant metadata.
5. **NEW** `src/lib/components/jkai/ResearchReferenceChips.svelte` — mirror FileReferenceChips; chip links to source URL (new tab) or `/deepdive/{sessionId}`.
6. `src/lib/components/jkai/ChatArea.svelte` — `@research` mention option + routing to `jkai-research`; `ResearchSearchRef` type; hydration; `done` handler; render chips; `openResearchRef`.
7. `~/.hermes-jkai/skills/jkai-research/SKILL.md` — add `research_search` as tool #11 + `@research` activation section + example. (Hermes repo — separate commit; reload skill after.)

## Verification

- `npm run check` (NODE_OPTIONS=--max-old-space-size=8192) — 0 new errors.
- `npx vitest run src/lib/deepdive/research-search.test.ts` — green.
- Integration: seed synthetic session+source+fact (real embedding) locally → `searchResearch("<topic>")` returns it ranked. Proves SQL end-to-end on real pgvector.
- Prod data-layer: run the cosine retrieval against the prod DB (803 embedded facts) with a real query embedding → returns grounded hits. Proves `@research` will have data.
- Deploy `scripts/deploy.sh`; confirm site live; reload Hermes so the jkai-research skill picks up the new instruction.

## Decision Log

| # | Fork | Options | Chosen | Why | Reversible |
|---|------|---------|--------|-----|-----------|
| 1 | Data source | (a) reuse `fact.embedding`; (b) build a new research embedding index | **(a)** | Already embedded on prod (803 facts), same embedder as deepdive chat, zero migration | Yes |
| 2 | Scope | (a) cross-session (all research); (b) per-session only | **(a)** default, `sessionId` optional | User said "materials in research activities" (plural) — the @files analog searches everything | Yes |
| 3 | minSim threshold | deepdive uses 0.5, @files uses 0.2 | **0.3** | Balance cross-session recall vs noise; top-K=8 caps drift; tunable const | Trivially |
| 4 | Chip link target | (a) source URL; (b) deepdive session page | **source URL (new tab), fallback `/deepdive/{id}`** | Web sources are the actual materials; session page as fallback when a fact has no source URL | Yes |
| 5 | `@files` + `@research` in one message | pin one skill (single value) | Keep existing `@files` precedence, then `@research` | Rare combo; a single turn pins one skill | Yes |
| 6 | Embedder | reuse `generateEmbedding` vs new | **reuse** (`text-embedding-3-small`) | Must match the model that wrote `fact.embedding`; confirmed identical | n/a |
| 7 | Essentials manifest | add `research_search` to essentials vs meta-tool discovery | **meta-tool discovery** (not essential) | Mirrors `file_search`; keeps MCP prefill low | Yes |
