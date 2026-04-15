# JKAI Memory System

**Date:** 2026-04-15
**Status:** Approved

## Problem

JKAI has no memory across conversations. Every conversation starts from zero — it doesn't know who your family are, what your preferences are, or what you've told it before. This forces you to re-explain context repeatedly and limits JKAI's usefulness as a personal assistant.

## Solution

A memory system with three parts:
1. **DB-backed memory store** — facts about the user, categorised and versioned
2. **Active tools** — JKAI can save, recall, and forget memories during conversations
3. **Background review job** — periodically scans finished conversations and extracts memories automatically

## 1. Memory Storage

### Table: `jkai_memories`

| Column | Type | Purpose |
|--------|------|---------|
| id | text (UUID PK) | |
| category | text NOT NULL | people, preferences, places, health, devices, situations |
| content | text NOT NULL | The memory, natural language |
| source_conversation_id | text (nullable) | Which conversation it came from |
| confidence | text NOT NULL DEFAULT 'high' | high / medium |
| created_at | timestamp | |
| updated_at | timestamp | Last refreshed or confirmed |
| superseded_by | text (nullable) | Points to the newer memory that replaced this one |

**Active memories** = rows where `superseded_by IS NULL`.

When a memory is updated (e.g., "John's mum moved from Whitley Bay to Tynemouth"), the old row gets `superseded_by` set to the new row's ID. This preserves history without cluttering the active set.

### Schema change: `jkai_conversations`

Add column: `last_memory_review` (timestamp, nullable) — tracks when the background job last reviewed this conversation for memories.

## 2. Memory Injection

In `generalChat()`, before building the messages array, load active memories and append a `--- Memory ---` section to the system prompt.

**Loading:**
- Query all active memories (`superseded_by IS NULL`)
- If total content exceeds 4000 characters, prioritise: recently updated first, high confidence before medium
- Group by category

**Format:**
```
--- Memory ---
**People:**
- John's mum lives in Whitley Bay
- John's partner is called Sarah

**Health:**
- Training for a half marathon in September 2026
- Left knee injury from March — avoiding downhill runs

**Preferences:**
- Prefers running in the morning
```

Built dynamically each call. Not cached in a prompt file.

## 3. Memory Tools

A new `memory` toolset registered in the site-tools system with three tools:

### `save_memory`
- **Params:** `category` (enum: people, preferences, places, health, devices, situations), `content` (string)
- **Behaviour:** 
  - Check existing active memories for semantic overlap (simple substring/keyword match)
  - If updating an existing memory: set `superseded_by` on the old row, insert new row
  - If new: insert directly
- **Used when:** User says "remember that...", or JKAI proactively notices an important fact

### `recall_memories`
- **Params:** `query` (string, optional), `category` (string, optional)
- **Behaviour:** Search active memories. If `query` provided, filter by case-insensitive substring match on content. If `category` provided, filter by category. If neither, return all active memories.
- **Used when:** JKAI needs to check what it knows before answering a question

### `forget_memory`
- **Params:** `id` (string)
- **Behaviour:** Set `superseded_by` to `'forgotten'` (a sentinel value, not a real ID). This soft-deletes the memory while preserving history.
- **Used when:** User says "forget that" or corrects something wrong

### Keyword classification

Add `memory` to the keyword classifier patterns:
```
/remember|forget|do you know|what do you know|recall|you told me|i told you|last time/i
```

## 4. Background Review Job

### Trigger
`setInterval` in `workflows/index.ts` startup, running every 30 minutes.

### Process

1. **Find candidates:** Query `jkai_conversations` where the last message in `orchestrator_chats` for that conversation is older than 30 minutes AND (`last_memory_review IS NULL` OR `last_memory_review` is before the last message timestamp).

2. **Extract:** For each candidate, pull messages since `last_memory_review` (or all messages if null). Send to LLM with an extraction prompt:

```
Review this conversation and extract facts worth remembering about the user.

Categories: people, preferences, places, health, devices, situations

Rules:
- Only extract facts useful in future conversations
- Do not extract ephemeral task details ("user asked to turn on lights")
- Do not extract sensitive data (passwords, financial details)
- Assign confidence: "high" if explicitly stated, "medium" if inferred
- If a fact updates something already in memory, note what it replaces

Return JSON array:
[{ "category": "...", "content": "...", "confidence": "high|medium", "updates": "content of memory it replaces, or null" }]

Return an empty array if nothing is worth remembering.
```

3. **Deduplicate:** For each extraction with `updates` set, find the matching active memory by substring match on the `updates` text, and supersede it.

4. **Persist:** Insert new memories, set `last_memory_review = now()` on the conversation.

### Cost control
- Most conversations yield 0-2 memories
- The extraction uses a single short LLM call per conversation (not per message)
- Only conversations with new activity since last review are processed
- Existing active memories are passed to the extraction prompt so the LLM can avoid duplicates

## 5. System Prompt

New file `data/prompts/07-memory.md`:

- Explains JKAI has a persistent memory of facts about the user
- Instructions to use `save_memory` proactively when learning important facts (names, preferences, locations, health details)
- Instructions to use `recall_memories` when a question might benefit from past context
- Watch for implicit facts (e.g., "I'm visiting my sister in Edinburgh" implies sister's location and a trip)
- Never store sensitive data (passwords, financial specifics)
- If a memory seems wrong based on new information, save the corrected version (which supersedes the old one)

## File Changes

| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | Add `jkaiMemories` table, add `lastMemoryReview` column to `conversations` |
| `src/lib/workflows/site-tools/tools/memory.ts` | New file — `save_memory`, `recall_memories`, `forget_memory` tools |
| `src/lib/workflows/site-tools/registry.ts` | Import `./tools/memory` |
| `src/lib/workflows/site-tools/keyword-classifier.ts` | Add `memory` pattern |
| `src/lib/workflows/site-tools/meta-tools.ts` | Add `memory` to `TOOLSET_NAMES` |
| `src/lib/workflows/chat/general-chat.ts` | Inject memory section into system prompt |
| `src/lib/workflows/chat/memory-review.ts` | New file — background review job logic |
| `src/lib/workflows/index.ts` | Start memory review interval on boot |
| `data/prompts/07-memory.md` | New prompt file with memory instructions |
| DB migration | `jkai_memories` table + `last_memory_review` column |

## Out of Scope

- Semantic/vector search for memories (simple substring matching is fine for now)
- Memory admin UI (manage via tools or direct DB for now)
- Memory sharing across users (single-user system)
- Automatic memory decay or expiry
