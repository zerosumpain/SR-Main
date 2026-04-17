# jkai Model Selector & Cost Tracking — Design

**Date:** 2026-04-17
**Project:** `strange_rambling_svelte`
**Status:** Draft — awaiting user review

---

## 1. Problem

Today, every `/jkai` interaction — both the orchestrator chat and the autonomous builder at `/jkai/builds` — hits Z.AI (`glm-4-plus` hardcoded, `glm-5-turbo` via `keys.json`). There is no way to:

- Switch providers at runtime (e.g., to an OpenRouter-hosted model for a specific task).
- Vary the model per conversation.
- See how much any given conversation or the system as a whole has cost.

This spec adds a model selector (admin-level default + per-conversation override) and cost tracking for OpenRouter-hosted models.

---

## 2. Goals / Non-Goals

**Goals**
- Admin UI at `/admin/models` to set default chat model and default builder model independently.
- Support two providers: **Z.AI** (GLM family) and **OpenRouter** (any model in their catalogue).
- Dynamic, filterable list of OpenRouter models in the admin UI, cached in DB.
- Per-conversation model override at conversation creation; locked after first message.
- Same pattern for new builds.
- Per-conversation running cost USD (shown in the conversation tab list).
- Global all-time cost KPI on `/jkai` main page (via `MetricsStrip`).
- Cost tracking is **zero** for Z.AI models (not computed, not stored beyond token counts).

**Non-Goals**
- Changing models mid-conversation.
- Per-message cost drill-down / analytics dashboard.
- Budgets / spend limits / alerts.
- Tokens-per-second or OpenRouter ranking filters in v1 (data is not in the public `/models` endpoint).
- Splitting cost by source (`web` vs `whatsapp-continuation`).

---

## 3. Decisions

- **Default model:** `glm-5.1` (updating from `glm-5-turbo` in `keys.json` defaults and the hardcoded fallbacks in `src/lib/jkai/llm-client.ts` and `src/lib/deepdive/keys.ts`).
- **GLM options** (hardcoded dropdown — Z.AI has no public `/models` endpoint): `glm-5.1` (default), `glm-5-turbo`, `glm-5v-turbo`.
- **OpenRouter API key storage:** source of truth is `keys.json` (`openrouterApiKey`); mirrored/editable in the `app_settings` table via the admin UI. On server start, `keys.json` seeds the DB value if empty; the DB value wins at runtime so admin edits take effect without a restart.
- **Model pinning:** conversations and builds store `model_provider` + `model_id` columns populated at creation time and never mutated.
- **OpenRouter model cache:** stored in `openrouter_models` table; refreshed on demand via a button in the admin UI. Auto-refresh is out of scope for v1.
- **Filters (v1):** modality, context length, cost (per 1M tokens), provider (id prefix), free-text name/id search.
- **Cost formula:** `prompt_tokens × prompt_price + completion_tokens × completion_price` in USD, computed from OpenRouter's `usage` block on each completion. Prices come from the cached `openrouter_models` row for the conversation's pinned `model_id` — **snapshotted at conversation creation time** into the conversation row, so price changes on OpenRouter don't retroactively alter a conversation's cost.

---

## 4. Data Model

### 4.1 New table: `app_settings`
Generic key/value store, reusable beyond this feature.

| Column | Type | Notes |
|---|---|---|
| `key` | `TEXT PRIMARY KEY` | e.g. `jkai.chat.default_model` |
| `value` | `JSONB NOT NULL` | Shape varies per key |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Seeded keys:**
- `jkai.chat.default_model` → `{ "provider": "zai", "modelId": "glm-5.1" }`
- `jkai.builder.default_model` → `{ "provider": "zai", "modelId": "glm-5.1" }`
- `openrouter.api_key` → `{ "value": "<from keys.json or empty>" }`

### 4.2 New table: `openrouter_models`
Cached snapshot of `GET https://openrouter.ai/api/v1/models`.

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | e.g. `anthropic/claude-opus-4` |
| `name` | `TEXT NOT NULL` | |
| `description` | `TEXT` | |
| `context_length` | `INTEGER` | |
| `prompt_price` | `NUMERIC(20,12)` | USD per token |
| `completion_price` | `NUMERIC(20,12)` | USD per token |
| `image_price` | `NUMERIC(20,12)` | USD per image (nullable) |
| `modality` | `TEXT` | e.g. `text->text`, `text+image->text` |
| `provider` | `TEXT` | derived from `id` prefix |
| `raw` | `JSONB NOT NULL` | full payload for forward-compat |
| `fetched_at` | `TIMESTAMPTZ NOT NULL` | |

Also store `openrouter.last_refreshed_at` in `app_settings` for display.

Index on `provider`, `modality` to support filter UI.

### 4.3 Columns added to `jkai_conversations`

| Column | Type | Notes |
|---|---|---|
| `model_provider` | `TEXT NOT NULL DEFAULT 'zai'` | `'zai'` or `'openrouter'` |
| `model_id` | `TEXT NOT NULL DEFAULT 'glm-5.1'` | |
| `prompt_tokens` | `BIGINT NOT NULL DEFAULT 0` | |
| `completion_tokens` | `BIGINT NOT NULL DEFAULT 0` | |
| `cost_usd` | `NUMERIC(12,6) NOT NULL DEFAULT 0` | Always 0 for zai |
| `price_snapshot` | `JSONB` | `{ promptPrice, completionPrice }` captured at conversation creation time — nullable for zai conversations |

### 4.4 Columns added to `jkai_builds`

| Column | Type | Notes |
|---|---|---|
| `model_provider` | `TEXT NOT NULL DEFAULT 'zai'` | |
| `model_id` | `TEXT NOT NULL DEFAULT 'glm-5.1'` | |
| `cost_usd` | `NUMERIC(12,6) NOT NULL DEFAULT 0` | |
| `price_snapshot` | `JSONB` | |

Existing `tokens_used` stays; it's populated alongside `cost_usd`.

---

## 5. Backend: LLM Client Refactor

### 5.1 Current state
`src/lib/jkai/llm-client.ts` exports a cached `getLLMClient()` returning `{ client: OpenAI, model: string }` — a single singleton pointed at Z.AI.

### 5.2 New shape

```ts
// src/lib/jkai/llm-client.ts
type ModelContext = {
  provider: 'zai' | 'openrouter';
  modelId: string;
};

export async function getLLMClient(ctx: ModelContext): Promise<{
  client: OpenAI;
  model: string;
}>;
```

- Two cached OpenAI client instances: one for Z.AI, one for OpenRouter. Cache keyed by provider (not model).
- OpenRouter base URL: `https://openrouter.ai/api/v1`.
- OpenRouter API key read from the merged `keys.json` + `app_settings` view.
- Callers pass in the conversation's or build's pinned `{ provider, modelId }`.

### 5.3 Call-site changes
All existing call sites currently invoke `getLLMClient()` with no args. They need the conversation or build id in scope — which they already do (orchestrator routes have the conversation; build runners have the build). Each call site is updated to:

1. Load the pinned model context from the conversation/build row (already in memory in most cases).
2. Pass it to `getLLMClient(ctx)`.
3. After the completion returns, inspect `response.usage` and call `recordUsage(conversationId, usage)` to update token/cost columns atomically (`UPDATE ... SET prompt_tokens = prompt_tokens + $1, ...`).

For Z.AI conversations, `recordUsage` still increments `prompt_tokens`/`completion_tokens` but leaves `cost_usd` at 0.

### 5.4 Default-model resolution
A thin helper `resolveDefaultModel('chat' | 'builder'): ModelContext` reads `app_settings` with a 30-second in-memory TTL. Used only at conversation/build creation; once created, the pinned value on the row is the source of truth.

---

## 6. Admin UI — `/admin/models`

A new page under the existing admin layout (auth already enforced by `hooks.server.ts`).

### 6.1 Layout (single page, two panels)

**Top panel — Defaults**
- Two dropdowns: "Default chat model" and "Default builder model".
- Each dropdown groups: `── Z.AI ──` (glm-5.1, glm-5-turbo, glm-5v-turbo) and `── OpenRouter ──` (searchable — typeahead filters the full cached list).
- Save button (single POST, updates both `app_settings` keys).

**Middle panel — OpenRouter configuration**
- `openrouter.api_key` input (masked, revealable).
- "Refresh model list" button — triggers server fetch, upserts `openrouter_models`, updates `openrouter.last_refreshed_at`.
- Last-refreshed timestamp + count ("412 models cached, last refreshed 14 minutes ago").

**Bottom panel — OpenRouter model browser** (collapsible, mostly for discovery)
- Filter bar: provider multi-select, modality multi-select, context-length slider (min), cost slider (max $/1M tokens), text search.
- Table: id · name · provider · modality · context · prompt $/1M · completion $/1M · "Set as chat default" · "Set as builder default" buttons.
- Server-side filtering via `GET /api/admin/models/openrouter?filters=…` returning paginated JSON (page size 50).

### 6.2 Server endpoints
- `GET  /api/admin/models/settings` — returns current defaults + OpenRouter key status (masked).
- `POST /api/admin/models/settings` — updates defaults and/or OpenRouter key.
- `POST /api/admin/models/openrouter/refresh` — triggers fetch + upsert.
- `GET  /api/admin/models/openrouter` — paginated/filtered model list for the browser.

All four require admin auth (same middleware as rest of `/admin`).

---

## 7. Per-Conversation Model Override

### 7.1 New conversation flow
When the user clicks "New conversation" in `/jkai`:

1. A small modal / inline panel appears with:
   - "Start conversation with:" dropdown — same grouped list as admin, defaulting to `jkai.chat.default_model`.
   - "Start" button.
2. On Start, `POST /api/jkai/conversations` includes `{ modelProvider, modelId }` in the body.
3. Row is created with the pinned model; no further changes possible.

### 7.2 Locking
- The chosen model is written to `model_provider`/`model_id` at row creation.
- There is no UI affordance to change the model after creation.
- On the conversation detail view, the model is displayed read-only beside the title (e.g., `GLM 5.1` or `Claude Opus 4`).

### 7.3 WhatsApp continuations
The `selectWhatsApp()` flow (see `src/routes/jkai/+page.svelte:52`) creates conversations implicitly. These always use the admin chat default — no picker (WhatsApp side has no UI for this).

### 7.4 Builds
The build creation form gets the same dropdown, defaulting to `jkai.builder.default_model`. Model is pinned on the `jkai_builds` row. No change to an in-flight build is possible.

---

## 8. Cost & KPI Display

### 8.1 Per-conversation
- `ConversationSidebar` tab shows cost on its own line beneath the last-message preview (e.g., `$0.023`). Hidden when `cost_usd = 0` (Z.AI conversations) to avoid visual noise.
- Conversation detail header shows `Model · $cost` for OpenRouter-backed conversations; just `Model` for Z.AI.

### 8.2 Global KPI
- `MetricsStrip` (already rendered at the top of `/jkai`) gets a new "Total spend" tile showing the sum across all conversations and builds.
- Period: **all-time** (simplest). Computed on page load via two `SUM()` queries. If the KPI doesn't fit the strip's width, fall back to rendering it above the conversation list.

### 8.3 Live updates
After each message send, `recordUsage` returns the new running totals to the client as part of the chat response. The sidebar and KPI update optimistically. No websocket needed.

---

## 9. Migration & Rollout

### 9.1 Schema migrations
Follow the existing SQL-file pattern in `supabase/migrations/` — one migration file `20260417_jkai_model_selector.sql` covering:
- Create `app_settings`.
- Create `openrouter_models`.
- Add columns to `jkai_conversations` and `jkai_builds`.
- Seed default `app_settings` rows.

Drizzle schema at `src/lib/db/schema.ts` updated to match.

### 9.2 Back-compat
- Existing conversations get `model_provider='zai'`, `model_id='glm-5.1'`, all cost/token columns default to 0 — they continue working.
- `keys.json` backfills `openrouter.api_key` on first server start if the DB row is empty or the `value` is empty string.

### 9.3 Default model change
The hardcoded fallback in `src/lib/jkai/llm-client.ts` and `src/lib/deepdive/keys.ts` changes from `glm-4-plus` → `glm-5.1`. `keys.json`'s `zaiModel` changes from `glm-5-turbo` → `glm-5.1` as part of deploy.

---

## 10. Error Handling

| Scenario | Behaviour |
|---|---|
| OpenRouter `/models` fetch fails (manual refresh) | Return error to admin UI; keep the stale cache. Admin sees an error toast. |
| OpenRouter key missing, but an OpenRouter-pinned conversation is opened | Chat send fails with a clear "OpenRouter API key not configured" error surfaced to the chat UI. |
| OpenRouter key invalid (401 from completion) | Surface provider error to chat UI verbatim; do not silently fall back to Z.AI (the model was deliberately chosen). |
| Pinned `model_id` no longer in `openrouter_models` cache | Conversation still works (we have a `price_snapshot`); admin browser just won't let you re-select it. |
| Cost computation overflow / missing `usage` in response | Log a warning, leave cost columns unchanged, don't fail the message. |

---

## 11. Testing

- **Unit:** `resolveDefaultModel`, `recordUsage` (cost arithmetic), `openrouter-refresh` mapper (raw OpenRouter JSON → `openrouter_models` row).
- **Integration:** hit `/api/admin/models/settings` and verify `app_settings` update; create a conversation with an OpenRouter pin and verify the row has the right snapshot.
- **Manual:** end-to-end send with both a Z.AI and an OpenRouter conversation, confirm sidebar + KPI update.

---

## 12. Open Questions

None at design time. Items deliberately deferred to v2: auto-refresh of OpenRouter catalogue, throughput/ranking filters, per-message cost drill-down, spend caps.
