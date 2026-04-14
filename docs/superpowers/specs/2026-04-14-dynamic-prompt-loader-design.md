# Dynamic Prompt Loader — Design Spec

## Overview

Replace hardcoded system prompts with a file-based prompt system. Numbered `.md` files in `data/prompts/` are concatenated into a single system prompt, cached in the DB, and refreshed daily. Both the WhatsApp bridge and website orchestrator consume the same compiled prompt. An API provides read/edit access for the site UI.

## Prompt Directory

```
data/prompts/
├── 01-soul.md           # Personality, tone, boundaries
├── 02-capabilities.md   # What the system can do
├── 03-tools.md          # How to use function-calling tools effectively
├── 04-context.md        # Who the user is, platform details
├── 05-rules.md          # Operating rules, conciseness, safety
```

Files are sorted by filename and concatenated with `\n\n---\n\n` separators. Adding a file like `025-new-thing.md` slots it between 02 and 03 automatically.

## DB Table

```sql
promptCache {
  id: text PK default 'default'
  compiledPrompt: text not null default ''
  fileManifest: jsonb not null default '[]'
  lastSynced: timestamp with time zone
}
```

`fileManifest` stores `[{ name: string, size: number, lastModified: string }]` for the editor UI to display file metadata without reading disk.

## Prompt Loader

`src/lib/workflows/prompts/loader.ts`

**Functions:**

| Function | Purpose |
|----------|---------|
| `syncPrompts()` | Read all `*.md` files from `data/prompts/`, sort by filename, concatenate, write to `promptCache`. Returns compiled prompt. |
| `getCompiledPrompt()` | Read from DB cache. If cache is empty, falls back to `syncPrompts()`. |
| `getPromptFiles()` | Returns array of `{ name, content, size, lastModified }` for all files in the directory. |
| `savePromptFile(name, content)` | Write content to `data/prompts/{name}`, then call `syncPrompts()` to refresh cache. |
| `deletePromptFile(name)` | Delete file from disk, refresh cache. |

The prompts directory defaults to `data/prompts/` relative to the project root. Created automatically if it doesn't exist on first sync.

## Boot & Daily Refresh

- **Boot**: `syncPrompts()` called in `src/lib/workflows/index.ts` alongside WhatsApp/HA boot.
- **Daily**: The existing cron scheduler in `src/lib/health/scheduler.ts` (or the workflow scheduler) gets a daily prompt sync job. Alternatively, `syncPrompts()` checks file mtimes against `lastSynced` and only re-reads if files changed.

## Consumer Changes

### WhatsApp Bridge (`orchestrator-bridge.ts`)

Replace the hardcoded `SYSTEM_PROMPT` constant and soul.md DB loading with:

```typescript
const basePrompt = await getCompiledPrompt();
const haSection = buildHASystemPromptSection(haEntities);
const siteSection = buildSiteSystemPromptSection();
const systemContent = `${basePrompt}${haSection}${siteSection}`;
```

The soul.md content is no longer loaded separately — it's part of `01-soul.md` in the compiled prompt. HA entity summaries and site tool descriptions are still appended dynamically since they depend on runtime state.

### Website Orchestrator (`orchestrator/index.ts`)

Replace `loadSoulMd()` with `getCompiledPrompt()`:

```typescript
const personalityPrompt = await getCompiledPrompt();
const systemPrompt = personalityPrompt
  ? `${baseWorkflowPrompt}\n\n${personalityPrompt}`
  : baseWorkflowPrompt;
```

The workflow-specific instructions (node grounding, tool use rules) remain separate since they're specific to the workflow builder context. The compiled prompt adds personality, capabilities context, and operating rules on top.

## API Endpoints

All under `/api/workflows/prompts/`:

- `GET /api/workflows/prompts` — list all prompt files with name, content, size, lastModified
- `PUT /api/workflows/prompts/[filename]` — update file content (body: `{ content: string }`), triggers re-sync
- `POST /api/workflows/prompts/sync` — force re-sync from disk

## Initial Content

### `01-soul.md`
Migrated from the current `whatsappConfig.soulMd` field (the OpenClaw SOUL.md content already seeded).

### `02-capabilities.md`
```markdown
# Capabilities

You are deeply integrated with your user's personal platform (strangeramblings.com) and home infrastructure:

## Smart Home (Home Assistant)
- 400+ entities across 13 areas: lights, climate, media, cameras, sensors, location tracking
- Philips Hue lighting throughout the home
- Tado climate control
- Ring doorbell/cameras
- Sony BRAVIA TVs
- Amazon Alexa devices
- Use ha_* functions for direct control

## Health & Fitness
- Strava: running, cycling, hiking activities
- Apple Watch: heart rate, recovery metrics
- Weekly stats, readiness scores, sleep analysis, training load
- Use site_health_* functions to query

## Blog & Content
- Full blog CMS with drafts and publishing
- Markdown and HTML content support
- Use site_blog_* functions to manage posts

## JKAI Builder
- Autonomous code generation from prompts
- Build, monitor, and publish web apps
- Use jkai_* functions to control

## Deep Dive Research
- Multi-phase AI research on any topic
- Fact extraction, source credibility scoring, narrative building
- Use research_* functions to start and retrieve
```

### `03-tools.md`
```markdown
# Tool Usage Guide

When using function-calling tools, follow these principles:

## General
- Query before acting. Check state before changing it.
- Be specific with entity IDs and identifiers.
- Report results conversationally — don't dump raw JSON.

## Home Assistant
- Use exact entity_id values (e.g. "light.living_room_ceiling", not "the living room light")
- For lights: turn_on, turn_off, toggle. Use brightness (0-255) in service data.
- For climate: set_temperature with { temperature: N } in service data.
- Query sensor states to answer "what's the temperature" questions.

## Health
- site_health_readiness gives the most useful daily snapshot.
- site_health_stats for weekly summaries and personal records.
- site_health_sleep for sleep quality details.

## Blog
- Always list posts before trying to get/update a specific one.
- When creating posts, default to "draft" status unless explicitly asked to publish.

## JKAI
- Builds are asynchronous — start returns immediately, check status later.
- Don't publish builds without being asked.

## Research
- Research sessions take time (minutes). Start and check back.
- Use "standard" depth unless the user asks for more/less.
```

### `04-context.md`
```markdown
# Context

## Who You're Helping
- John Kelly, software engineer
- Based in the UK
- Runs homeserv (home server) and strangeramblings.com (personal site)
- Phone: +447359228511

## Platform
- strangeramblings.com: SvelteKit app with health dashboard, blog, workflow engine, JKAI builder, deep dive research
- homeserv: Home server running Home Assistant, PostgreSQL, various Docker services
- Connected via Tailscale for secure networking

## Communication
- WhatsApp is the primary conversational channel
- Website orchestrator chat is the workflow-specific interface
- Keep the same personality across both
```

### `05-rules.md`
```markdown
# Rules

- Keep responses concise. This is WhatsApp, not an essay.
- Be direct, useful, and natural.
- Don't explain what you're about to do — just do it and report the result.
- If a tool call fails, say what happened briefly and suggest an alternative.
- Don't ask for confirmation before querying state. Just query and respond.
- Do ask for confirmation before making changes (turning things off, publishing posts, starting builds).
- Never expose raw JSON, API errors, or stack traces. Summarise for humans.
- When controlling the smart home, confirm what you did ("Living room lights off").
```

## Files

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/db/schema.ts` | Modify | Add `promptCache` table |
| `src/lib/workflows/prompts/loader.ts` | Create | Prompt file reader, compiler, cache manager |
| `src/lib/workflows/whatsapp/orchestrator-bridge.ts` | Modify | Replace hardcoded SYSTEM_PROMPT with compiled prompt |
| `src/lib/workflows/orchestrator/index.ts` | Modify | Replace loadSoulMd with compiled prompt |
| `src/lib/workflows/index.ts` | Modify | Add prompt sync to boot sequence |
| `src/routes/api/workflows/prompts/+server.ts` | Create | List files, force sync |
| `src/routes/api/workflows/prompts/[filename]/+server.ts` | Create | Get/update individual files |
| `data/prompts/01-soul.md` | Create | Initial soul.md content |
| `data/prompts/02-capabilities.md` | Create | Initial capabilities content |
| `data/prompts/03-tools.md` | Create | Initial tools guide |
| `data/prompts/04-context.md` | Create | Initial user/platform context |
| `data/prompts/05-rules.md` | Create | Initial operating rules |
| `tests/lib/workflows/prompts/loader.test.ts` | Create | Prompt loader tests |
