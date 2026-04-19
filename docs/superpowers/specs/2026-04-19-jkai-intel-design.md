# JKAI Intel — Knowledge Graph & Intelligence System

**Date:** 2026-04-19
**Status:** Draft
**Approach:** Postgres + pgvector (Approach B)

## Overview

A personal knowledge management and intelligence layer for JKAI, designed for onboarding into a new job. Captures notes from multiple channels (web, WhatsApp, PWA, email), auto-extracts entities and relationships into a knowledge graph, and surfaces connections proactively. The primary interface is a navigation dashboard for situational awareness; chat serves as a secondary tool for deeper queries.

## Requirements

- **Multi-format ingestion**: text, handwriting scans (camera), audio recordings, emails, meeting transcripts, summaries
- **Four ingestion channels**: web UI, WhatsApp (via OpenClaw), capture PWA, email forwarding
- **Automatic entity extraction**: aggressive auto-extraction with LLM, low-confidence items queued for user confirmation
- **Emergent ontology**: seeded with core entity types, JKAI proposes new types as it encounters novel categories (biased toward acceptance)
- **Semantic recall**: newly arriving notes find relevant existing knowledge via vector similarity and surface significant connections
- **Push notifications**: high-significance connections pushed to WhatsApp immediately
- **Multi-dimensional navigation**: entity-centric, project-centric, and timeline-centric views onto the same graph
- **Chat integration**: existing JKAI chat enhanced with knowledge graph context

## Data Model

All tables prefixed `intel_` to namespace within the existing schema.

### intel_notes

The raw input — every note, transcript, scan, email that enters the system.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid, PK | |
| title | text | User-provided or LLM-generated title |
| rawContent | text | Original text as received |
| processedContent | text | Cleaned/structured version after preprocessing |
| source | enum: web, whatsapp, pwa, email | Ingestion channel |
| format | enum: text, handwriting_scan, audio_transcript, email, meeting_transcript, summary | Content format |
| embedding | vector(1536) | pgvector embedding for semantic search |
| status | enum: pending, processing, processed, failed | Pipeline status |
| metadata | jsonb | Source-specific extras (email headers, WhatsApp message ID, etc.) |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### intel_entity_types

The taxonomy — seeded with core types, emergent types auto-created.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid, PK | |
| name | text | e.g. "person", "project", "risk" |
| icon | text | Emoji or icon name for UI |
| color | text | Display color |
| isSeeded | boolean | true for core types, false for emergent |
| description | text | What this type represents |
| propertySchema | jsonb | Expected properties for entities of this type |
| createdAt | timestamp | |

**Seeded types:** Person, Project, Team, Risk, Decision, Deadline, Organisation, System/Tool.

### intel_entities

Knowledge graph nodes — people, projects, risks, decisions, etc.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid, PK | |
| name | text | Display name |
| typeId | FK → intel_entity_types | |
| summary | text | LLM-generated rolling summary, updated as new notes arrive |
| properties | jsonb | Type-specific fields (e.g. Person: role, department, reports_to) |
| embedding | vector(1536) | For semantic entity matching |
| confidence | enum: high, medium, low | Extraction confidence |
| confirmed | boolean | User has verified this entity |
| mergedIntoId | uuid, nullable, FK → intel_entities | For deduplication |
| firstSeenIn | FK → intel_notes | Provenance |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### intel_relationships

Directed, typed edges between entities.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid, PK | |
| sourceEntityId | FK → intel_entities | |
| targetEntityId | FK → intel_entities | |
| type | text | e.g. "reports_to", "owns", "blocks", "stakeholder_in" |
| label | text | Human-readable description |
| strength | enum: strong, moderate, weak | |
| properties | jsonb | Additional relationship data |
| confidence | enum: high, medium, low | |
| sourceNoteId | FK → intel_notes | Which note this was extracted from |
| createdAt | timestamp | |

### intel_note_entities

Junction table: which entities appear in which notes.

| Column | Type | Description |
|--------|------|-------------|
| noteId | FK → intel_notes | |
| entityId | FK → intel_entities | |
| relevance | enum: primary, mentioned, inferred | How central the entity is to this note |
| excerpt | text | The relevant passage from the note |

Composite PK on (noteId, entityId).

### intel_timeline_events

Explicit temporal markers extracted from notes.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid, PK | |
| entityId | FK → intel_entities, nullable | Linked entity (if applicable) |
| noteId | FK → intel_notes | Source note |
| date | date | Event date |
| dateEnd | date, nullable | End date for ranges |
| type | enum: deadline, milestone, event, decision | |
| title | text | |
| description | text | |
| createdAt | timestamp | |

### intel_alerts

Connections surfaced during ingestion.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid, PK | |
| noteId | FK → intel_notes | The note that triggered this alert |
| type | enum: connection, risk_change, contradiction, pattern | |
| title | text | |
| content | text | Explanation of the connection |
| significance | enum: high, medium, low | |
| relatedEntityIds | uuid[] | Entities involved |
| delivered | boolean | Whether pushed to WhatsApp |
| dismissed | boolean | User dismissed this alert |
| createdAt | timestamp | |

## Ingestion Pipeline

Four-stage async pipeline. Notes are accepted immediately (status: pending) and processed in the background.

### Stage 1: Receive & Normalise

All channels converge on `POST /api/jkai/intel/ingest`, which creates an `intel_notes` row and queues processing.

- **Web UI**: `/jkai/intel/notes/new` — text input + file upload (multipart)
- **WhatsApp**: OpenClaw message hook, triggered by `intel:` or `/note` prefix. Forwards text + media to ingest endpoint.
- **PWA**: Same ingest endpoint, called from the capture app
- **Email**: Via existing OpenClaw email channel integration. User forwards emails to the configured email channel, which routes to the ingest endpoint. Parses subject, body, sender, date, attachments. Strips signatures/footers.

### Stage 2: Preprocess

Format-dependent preprocessing to produce text:

- **Handwriting scan**: LLM vision (multimodal call) to extract text from image. Original image stored as attachment.
- **Audio**: Whisper API or LLM audio transcription. Audio file stored as attachment.
- **Text/Email/Transcript**: Already text — minimal cleanup (email header extraction, signature stripping).

### Stage 3: Extract & Embed

Single LLM call with structured JSON output. The prompt includes:

- The processed note text
- Existing entity names and types (for dedup matching — the LLM can say "this Sarah is probably existing entity X")
- Recent relationship context for disambiguation

The LLM returns:

```json
{
  "summary": "cleaned, structured version of the note",
  "entities": [
    {
      "name": "Sarah Chen",
      "type": "person",
      "confidence": "high",
      "properties": { "role": "Engineering Lead", "team": "Platform" },
      "possibleMatchId": "existing-entity-uuid-or-null"
    }
  ],
  "relationships": [
    {
      "source": "Sarah Chen",
      "target": "Platform Migration",
      "type": "stakeholder_in",
      "label": "Key stakeholder in the migration project",
      "confidence": "high"
    }
  ],
  "timelineEvents": [
    {
      "date": "2026-05-01",
      "type": "deadline",
      "title": "Q3 planning kickoff",
      "linkedEntity": "Platform Migration"
    }
  ],
  "proposedNewTypes": [
    {
      "name": "vendor",
      "description": "External company providing services",
      "icon": "🏭"
    }
  ]
}
```

Separately, generate a vector embedding of the processed text for semantic search.

### Stage 4: Persist & Recall

**Persist:**
- Upsert entities: if `possibleMatchId` is provided and confidence is high, merge into existing entity and update its rolling summary. Otherwise create new.
- Create relationships and note_entity junctions.
- Insert timeline events.
- Auto-accept proposed new entity types (biased toward acceptance).
- Update note status → processed.

**Recall:**
- Vector search the new note's embedding against existing notes and entities (top-K, e.g. K=20).
- LLM evaluates top matches for genuine connections vs. superficial similarity.
- LLM scores significance (high/medium/low) and categorises (connection, risk_change, contradiction, pattern).
- Create `intel_alerts` for genuine connections.
- High significance alerts → push to WhatsApp via OpenClaw.
- Low-confidence entities → appear in the review queue.

## Navigation UI

### Route Structure

```
/jkai/intel/                    Dashboard hub
/jkai/intel/notes               Note browser (search, filter by source/format/date)
/jkai/intel/notes/[id]          Note detail (content, extracted entities highlighted)
/jkai/intel/notes/new           Manual note creation
/jkai/intel/entities            Entity browser (search, filter by type)
/jkai/intel/entities/[id]       Entity dossier (profile, relationships, timeline, notes)
/jkai/intel/timeline            Chronological view (filterable)
/jkai/intel/graph               Relationship map (force-directed visualisation)
/jkai/intel/alerts              Connection feed
/jkai/intel/review              Confirmation queue (low-confidence entities, merges, new types)
```

### Dashboard Hub (`/jkai/intel/`)

The landing page for situational awareness:

- **Stats bar**: total notes, total entities, active risks, items pending review
- **Recent alerts**: colour-coded by significance (red/amber/blue) with links to detail
- **Recent notes**: latest ingested notes with processing status
- **Key people**: most-connected person entities, clickable to dossier
- **Upcoming timeline**: next deadlines, milestones, events

### Entity Dossier (`/jkai/intel/entities/[id]`)

Full profile for any entity:

- **Header**: name, type badge, confirmation status
- **Summary**: LLM-generated rolling summary updated as new notes mention this entity
- **Properties**: type-specific fields (role, department, etc.)
- **Relationships**: all edges from/to this entity, grouped by type, clickable to target entity
- **Timeline**: chronological events involving this entity
- **Associated risks**: risk entities linked to this entity
- **Appears in**: list of notes where this entity was extracted, with relevant excerpts

### Timeline View (`/jkai/intel/timeline`)

Chronological view of all timeline events. Filterable by entity, project, event type. Shows deadlines approaching, milestones passed, decisions made.

### Graph View (`/jkai/intel/graph`)

Force-directed graph visualisation (D3.js or similar). Nodes are entities (sized by connection count, coloured by type). Edges are relationships. Clickable to entity dossier. Filterable by entity type, relationship type, time range.

### Review Queue (`/jkai/intel/review`)

Batch review of items needing confirmation:

- Low-confidence entities: accept, reject, or edit
- Proposed merges: "Is Sarah from note A the same as Sarah Chen from note B?"
- New entity type proposals: accept or reject
- Card-based UI with batch operations

## Chat Integration

The existing JKAI chat at `/jkai` gets knowledge-aware context injection. No separate chat UI.

When a user sends a message in JKAI chat:

1. Embed the user's message
2. Vector search `intel_notes` and `intel_entities` for relevant context
3. If relevant results found, inject a "knowledge context" block into the system prompt containing: matching entity summaries, their relationships, and relevant note excerpts with citations
4. LLM responds with awareness of the knowledge graph, citing source notes
5. Entity names in responses can be linkified to their dossier pages

The chat can also act as an ingestion source: if the user says something like "remember that Sarah's team also owns the API gateway", extract and store it like any other note (source: web).

## Alert & Notification System

### Significance Tiers

| Tier | Trigger | Action |
|------|---------|--------|
| High | Risk changes, contradictions between sources, strong cross-entity connections | Push to WhatsApp immediately via OpenClaw |
| Medium | New entity connections, pattern detection, entity updates | Visible on dashboard and alerts feed |
| Low | Low-confidence extractions, proposed merges, new type proposals | Queued in review page |

### WhatsApp Alert Format

```
🔴 Intel Alert: Sarah's vendor concern from today's 1:1 matches a risk Tom flagged last week (Vendor Delivery Delay). Both point to Q3 impact.

View: https://strangeramblings.com/jkai/intel/alerts/{id}
```

### Significance Scoring

After vector recall finds potential connections, a lightweight LLM call evaluates each match:

- Is this a genuine connection or superficial similarity? (filter false positives)
- What type — risk escalation, contradiction, reinforcement, new link? (categorise)
- How significant — would the user want to know about this right now? (score)

Only high-significance alerts get pushed. The LLM is the judge, not just vector distance.

## Capture PWA

Lightweight capture-only app at `intel.strangeramblings.com`. Browsing the knowledge graph stays on the main site.

### Features

- **Text input**: type or paste notes
- **Camera capture**: MediaDevices API for photographing whiteboards/handwriting
- **Audio recording**: MediaRecorder API for voice memos
- **Format hints**: optional selector (meeting notes, transcript, email, summary, raw thought) to guide extraction
- **Offline support**: service worker caches app shell, notes created offline stored in IndexedDB, synced to `/api/jkai/intel/ingest` when connectivity returns

### Hosting

Separate subdomain on the same VPS. Lightweight SvelteKit app or static build + service worker. Auth via same Google OAuth session (cookie domain set to `.strangeramblings.com` so the session cookie is shared across subdomains). The PWA calls the main site's API endpoints at `strangeramblings.com/api/jkai/intel/ingest` directly — no separate backend needed.

## Component Architecture

Core engine modules under `src/lib/jkai/intel/`:

| Module | Responsibility |
|--------|---------------|
| `ingest.ts` | Receive notes from all channels, normalise, queue for processing |
| `preprocess.ts` | OCR (LLM vision), audio transcription (Whisper/LLM), email parsing |
| `extract.ts` | LLM entity/relationship/timeline extraction with structured JSON output |
| `embed.ts` | Vector embedding generation for notes and entities |
| `recall.ts` | Semantic search on ingestion, connection evaluation, alert generation |
| `graph.ts` | Entity and relationship CRUD, merge/dedup operations, summary updates |
| `context.ts` | Build knowledge graph context for chat system prompt injection |
| `notify.ts` | WhatsApp push via OpenClaw for high-significance alerts |

### API Endpoints

```
POST   /api/jkai/intel/ingest              Ingest a note (all channels)
GET    /api/jkai/intel/notes               List notes (paginated, filterable)
GET    /api/jkai/intel/notes/[id]          Get note detail
DELETE /api/jkai/intel/notes/[id]          Delete note
GET    /api/jkai/intel/entities            List entities (paginated, filterable by type)
GET    /api/jkai/intel/entities/[id]       Get entity dossier
PUT    /api/jkai/intel/entities/[id]       Update entity (edit, confirm, merge)
DELETE /api/jkai/intel/entities/[id]       Delete entity
GET    /api/jkai/intel/timeline            List timeline events (filterable)
GET    /api/jkai/intel/alerts              List alerts (filterable by significance)
PUT    /api/jkai/intel/alerts/[id]         Dismiss alert
GET    /api/jkai/intel/review              Get pending review items
POST   /api/jkai/intel/review/[id]/accept  Accept review item
POST   /api/jkai/intel/review/[id]/reject  Reject review item
GET    /api/jkai/intel/search              Semantic search across notes and entities
GET    /api/jkai/intel/stats               Dashboard stats
GET    /api/jkai/intel/graph               Graph data for visualisation (nodes + edges)
```

## Build Phases

This system is too large for a single implementation cycle. Each phase is independently useful.

### Phase 1 — Foundation

Schema (pgvector extension + all tables), ingest API endpoint, extraction pipeline (preprocess → extract → persist), basic note and entity CRUD pages. Outcome: you can start capturing and browsing notes immediately.

### Phase 2 — Intelligence Dashboard

Dashboard hub, entity dossier page, timeline view, note browser with search, entity browser with type filtering. Outcome: full navigation across the knowledge graph.

### Phase 3 — Semantic Recall & Alerts

Vector embedding on ingestion, semantic search for connections, alert generation with LLM significance scoring, WhatsApp push notifications via OpenClaw. Outcome: notes proactively surface relevant existing knowledge.

### Phase 4 — Chat Enhancement

Knowledge-aware context injection into existing JKAI chat. Entity linkification in chat responses. Chat-as-ingestion for conversational knowledge capture. Outcome: ask JKAI questions about your knowledge graph.

### Phase 5 — Capture PWA

Separate lightweight app at `intel.strangeramblings.com`. Camera capture, audio recording, offline support with sync. Outcome: quick capture from your phone.

### Phase 6 — Graph Visualisation

Force-directed relationship map using D3.js. Interactive — click to navigate, filter by type/time. Outcome: visual exploration of the entity network.

## Technical Dependencies

- **pgvector**: Postgres extension, needs to be installed on homeserv's Postgres instance
- **Embedding model**: via existing Z.AI or OpenRouter providers (e.g. text-embedding-3-small)
- **Whisper**: for audio transcription (OpenAI API or self-hosted)
- **D3.js**: for graph visualisation (Phase 6)
- **Existing infrastructure**: Drizzle ORM, SvelteKit, OpenClaw WhatsApp integration, Google OAuth
