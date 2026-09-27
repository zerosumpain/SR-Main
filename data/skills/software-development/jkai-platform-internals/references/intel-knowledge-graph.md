# Intel Knowledge Graph

> **2026-09-27 (intel basics): much of this page is history.** SR-Jkai-Core owns intel; Main's copy of
> `src/lib/jkai/intel` is deleted. Main keeps a thin read/outbox client in `src/lib/intel-client/` and the
> pure graph maths in `src/lib/graph-analytics/`. `intel_insights` and `intel_unlikely_relations` are
> gone (insights and surprise scoring were deleted in Core); `intel_find`, `intel_neighbourhood`,
> `intel_path` and `knowledge_search` remain.

The intel knowledge graph is a pre-computed entity-relationship layer over everything JKai knows: files, research, Gmail, chat, and hand-written notes. It adds a **relational dimension** that raw text storage can't provide — who connects to whom, what bridges separate domains, and what the graph noticed on its own.

## Quick Stats (as of 2026-08-08)

| Metric | Value |
|--------|-------|
| Entities | 6,306 |
| Relationships | 6,590 |
| Clusters | 2,208 |
| Modularity | 0.841 |

## How It's Populated

The entity graph is built by the **auto-extraction pipeline** (`src/lib/jkai/intel/auto-extract.ts`), which runs the same `extract → persist → embed` path on every source:

| Source | AutoKind | How it enters |
|--------|----------|---------------|
| `/drive` files | `file` | On upload or nightly sweep — entities extracted from uploaded documents |
| Research sessions | `research` | When a deep-dive completes — entities from the research findings |
| Gmail threads | `file` (source override: `email`) | Rolling Gmail sweep — entities from email correspondence |
| /jkai chat threads | `chat` | On each reply — entities from the conversation, re-extracted as it grows |
| Hand-written intel notes | (none) | Manually authored at `/admin/intel` |

Each auto-extracted note is tagged `metadata.autoKind` so the recall layer can distinguish it from human-authored notes.

**Gates:**
- Content-hash deduped — unchanged files skip re-extraction
- Text capped at 24,000 chars per item (too-short items < 200 chars are skipped)
- Kill switch: `INTEL_AUTO_EXTRACT=0`
- Nightly sweep at 04:15 (after the 03:30 self-improvement pass)

## The Knowledge Stores

When `knowledge_search` fans out, it searches these six stores in parallel:

| Source | Search method | What it returns |
|--------|--------------|-----------------|
| `notes` | Semantic embedding + ILIKE | Hand-written intel notes only (auto-derived notes suppressed — their text is already covered by files/research) |
| `entities` | Semantic embedding + ILIKE | Entity cards (name, type, summary, connection count) |
| `files` | Semantic embedding | File passages with chunk-level citations |
| `research` | Semantic embedding | Research fact passages |
| `memory` | Keyword ILIKE | Personal memory entries |
| `datastore` | Keyword JSON scan | Datastore records |

The intel notes and entities branches share a **single embedding call** (`searchIntel` in `src/lib/jkai/intel/search.ts`) — one vector query, two SQL result sets. Auto-derived notes are filtered out of the notes branch (line 92-94 of `src/lib/knowledge/search.ts`), but the entities they produced are still surfaced via the entities branch.

## Token-Cost Value

### Pre-computed extraction
Entity extraction, relationship linking, embedding, clustering, and community detection all happen **offline** (nightly sweep + rolling Gmail ingestion). The agent never pays those LLM calls.

### Compressed representations
An entity's `summary` is an LLM-distilled ~200-300 char description. Instead of reading 5 files to reconstruct who "John Kelly" is, `intel_find` returns a structured entity card with type, summary, 483 connections, and broker status in one tool call (~200 tokens returned).

### Structured navigation
`intel_find` → `intel_neighbourhood` gives the N-hop neighbourhood of any entity. That replaces reading N source files to trace connections manually.

## Available Tools

| Tool | What it does |
|------|-------------|
| `intel_find` | Find entities by name or partial name. Returns type, connection count, broker status. Use this first to get an entity ID. |
| `intel_neighbourhood` | Walk the N-hop neighbourhood of an entity. Returns connected entities grouped by hop distance with relationship descriptions. |
| `intel_path` | Trace how two entities are connected — the chain of relationships between them, and alternative routes. |

## Key Source Files

| File | Purpose |
|------|---------|
| `src/lib/jkai/intel/engine.ts` | Nightly sweep orchestrator (04:15, prod-only) |
| `src/lib/jkai/intel/auto-extract.ts` | Entity extraction from files, research, Gmail, chat |
| `src/lib/jkai/intel/search.ts` | Unified semantic search over notes + entities (one embedding, two queries) |
| `src/lib/jkai/intel/graph.ts` | Entity graph persistence (extract → persist → embed) |
| `src/lib/jkai/intel/analytics/insights.ts` | Rule-based detectors (10 kinds) |
| `src/lib/knowledge/search.ts` | `knowledge_search` — fan-out across 6 stores |
| `src/lib/workflows/site-tools/tools/knowledge.ts` | MCP tool definition for `knowledge_search` |
| `src/lib/workflows/site-tools/tools/intel-graph.ts` | MCP tool definitions for all `intel_*` tools |
| `src/lib/jkai/intel/embed.ts` | Embedding generation for entities + notes |
| `src/lib/jkai/intel/extract.ts` | LLM-based entity extraction from note text |
| `src/lib/jkai/intel/confirm-link.ts` | Manual link confirmation endpoint |
| `src/lib/jkai/intel/staleness.ts` | Entity staleness tracking |
| `src/lib/jkai/intel/entity-card-store.ts` | Entity card rendering data |
| `src/lib/jkai/intel/trust-refresh.ts` | Confidence score backfill |
| `src/lib/jkai/intel/gmail-ingest.ts` | Gmail thread → entity extraction |
| `src/lib/jkai/intel/gmail-attachments.ts` | Gmail attachment extraction |
| `src/lib/jkai/intel/chat-extract.ts` | Chat thread → entity extraction |
| `src/lib/jkai/intel/resolve/merge.ts` | Duplicate entity merging |
| `src/lib/jkai/intel/resolve/match.ts` | Entity matching for merge candidates |
| `src/lib/jkai/intel/source-policy.ts` | Source category routing |
| `src/lib/jkai/intel/run-log.ts` | Sweep run logging to `intel_runs` collection |
| `src/lib/jkai/intel/analytics/load.ts` | Graph analysis snapshot loading |
| `src/lib/jkai/intel/analytics/model.ts` | Graph analysis data model |
| `src/lib/jkai/intel/analytics/surprise.ts` | Unlikely relation + missing link scoring |
| `src/lib/jkai/intel/analytics/centrality.ts` | Brokerage/centrality scoring |
| `src/lib/jkai/intel/analytics/filter.ts` | Insight result filtering |
| `src/lib/jkai/thread-graph.ts` | Thread-graph UI integration (conversation concept rail) |

## Entity Graph Schema

```sql
-- intel_entities: the entity nodes
id (uuid) | name (text) | type_id (uuid → intel_entity_types) | summary (text)
| embedding (vector) | merged_into_id (uuid, nullable) | confirmed (boolean)
| created_at | updated_at | last_seen_at

-- intel_entity_types: entity type taxonomy
id (uuid) | name (text) | description (text)

-- intel_relationships: typed edges between entities
id (uuid) | source_id (uuid → intel_entities) | target_id (uuid → intel_entities)
| relationship_type (text) | weight (float) | source_url (text)
| created_at | updated_at

-- intel_notes: the text that entities were extracted from
id (uuid) | title (text) | raw_content (text) | processed_content (text)
| embedding (vector) | metadata (jsonb) | source (text)
| created_at | updated_at

-- intel_note_entities: bridge table — which entities appear in which notes
note_id (uuid → intel_notes) | entity_id (uuid → intel_entities)