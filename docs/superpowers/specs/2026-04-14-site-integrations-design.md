# Site Integrations (Health/Blog, JKAI, Deep Dive) — Design Spec

## Overview

Add three site integrations to the workflows engine and WhatsApp conversational AI: health/blog data access, JKAI autonomous builds, and Deep Dive research. All follow the same pattern as the Home Assistant integration — LLM function-calling tools for WhatsApp and workflow nodes for the visual editor.

## Architecture

No new services needed. Each integration is:
1. A set of LLM tool definitions (function calling) added to the orchestrator bridge
2. A workflow node (executor + definition) for visual automation
3. Thin wrappers calling existing internal API endpoints or querying the DB directly

All tools are added to the same orchestrator bridge tool-calling loop alongside the existing HA tools.

## Integration 1: Health & Blog

### LLM Tools

| Function | Internal Call | Purpose |
|----------|--------------|---------|
| `site_health_stats` | `GET /api/health/stats` | Weekly metrics (distance, duration, elevation, recovery) + personal records |
| `site_health_readiness` | `GET /api/health/readiness` | Composite readiness score, zone, recommendation |
| `site_health_sleep` | `GET /api/health/sleep-analysis` | Latest sleep (duration, stages, performance) + 14-day trend |
| `site_health_training_load` | `GET /api/health/training-load` | Acute/chronic load ratio, zone, 30-day history |
| `site_health_timeline(page?, limit?)` | `GET /api/health/timeline` | Paginated merged events from Strava/Whoop |
| `site_blog_list(status?)` | `GET /api/admin/blog` | List posts (optionally filter by draft/published) |
| `site_blog_get(id)` | `GET /api/admin/blog/{id}` | Get full post content + tags |
| `site_blog_create(title, content, status?, tags?)` | `POST /api/admin/blog` | Create new blog post |
| `site_blog_update(id, changes)` | `PUT /api/admin/blog/{id}` | Update post (title, content, status, tags) |

### Workflow Nodes

**`health-query` node** (integration category):
- Config: `operation` dropdown (stats, readiness, sleep, training_load, timeline)
- For timeline: `page` and `limit` number fields
- Output: `{ success: boolean, data: any }`

**`blog` node** (integration category):
- Config: `operation` dropdown (list, get, create, update)
- For get/update: `postId` field (template-interpolatable)
- For create: `title`, `content`, `status`, `tags` fields
- For update: `postId`, `changes` JSON field
- Output: `{ success: boolean, data: any }`

## Integration 2: JKAI

### LLM Tools

| Function | Internal Call | Purpose |
|----------|--------------|---------|
| `jkai_start_build(prompt, title?)` | `POST /api/jkai/builds` | Start a new autonomous build |
| `jkai_get_build(id)` | `GET /api/jkai/builds/{id}` | Get build status + iterations |
| `jkai_list_builds()` | `GET /api/jkai/builds` | List recent builds with status |
| `jkai_control_build(id, action)` | `POST /api/jkai/builds/{id}/{action}` | Pause, resume, stop, or publish a build |

### Workflow Node

**`jkai` node** (integration category):
- Config: `operation` dropdown (start, status, list, control)
- For start: `prompt` (template-textarea), `title` (text)
- For status: `buildId` (template-interpolatable)
- For control: `buildId`, `action` dropdown (pause, resume, stop, publish)
- Output: `{ success: boolean, data: any }`

## Integration 3: Deep Dive Research

### LLM Tools

| Function | Internal Call | Purpose |
|----------|--------------|---------|
| `research_start(topic, goals?, depth?)` | `POST /api/deepdive` | Start a research session |
| `research_status(id)` | `GET /api/deepdive/{id}` | Check progress, phase, stats |
| `research_list()` | `GET /api/deepdive` | List recent research sessions |
| `research_get_report(id)` | `GET /api/deepdive/{id}/narrative` | Get narrative findings |
| `research_control(id, action)` | `PATCH /api/deepdive/{id}` | Stop or skip phase |

### Workflow Node

**`deep-dive` node** (integration category):
- Config: `operation` dropdown (start, status, list, report, control)
- For start: `topic` (template-textarea), `goals` (textarea, JSON array), `depth` dropdown (shallow, standard, deep)
- For status/report: `sessionId` (template-interpolatable)
- For control: `sessionId`, `action` dropdown (stop, skip)
- Output: `{ success: boolean, data: any }`

## Implementation Approach

### Tool Definitions File

Create `src/lib/workflows/site-tools/llm-tools.ts` containing all tool definitions for health, blog, JKAI, and deep dive. Export:
- `SITE_TOOL_DEFINITIONS` — array of all function definitions
- `buildSiteSystemPromptSection()` — returns a string describing available site capabilities for the system prompt

### Tool Execution

Create `src/lib/workflows/site-tools/executor.ts` containing:
- `executeSiteTool(fnName, fnArgs)` — switch on function name, calls the appropriate internal API endpoint via fetch to `http://localhost:${PORT}` (same process, so use the origin from the request or a configured base URL)
- Returns `{ success, data?, error? }`

### Orchestrator Bridge Update

In `src/lib/workflows/whatsapp/orchestrator-bridge.ts`:
- Import `SITE_TOOL_DEFINITIONS` and `executeSiteTool`
- Merge site tools with HA tools in the `tools` array passed to the LLM
- Add site tool execution to the tool-call switch statement
- Append site capabilities section to system prompt

### Workflow Nodes

Each node follows the same pattern as home-assistant.ts:
- Switch on operation type
- Call internal API endpoint
- Return structured result

Since health/blog/JKAI/deep-dive are all internal to the same app, the nodes can call the API endpoints directly via fetch to localhost, or import the relevant lib modules. Using fetch keeps the nodes decoupled from the internal implementation.

## Files

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/workflows/site-tools/llm-tools.ts` | Create | All LLM tool definitions + system prompt section |
| `src/lib/workflows/site-tools/executor.ts` | Create | Tool execution (calls internal APIs) |
| `src/lib/workflows/nodes/health-query.ts` | Create | Health query workflow node |
| `src/lib/workflows/nodes/blog.ts` | Create | Blog workflow node |
| `src/lib/workflows/nodes/jkai.ts` | Create | JKAI workflow node |
| `src/lib/workflows/nodes/deep-dive.ts` | Create | Deep Dive workflow node |
| `src/lib/workflows/whatsapp/orchestrator-bridge.ts` | Modify | Add site tools to LLM function calling |
| `src/lib/workflows/index.ts` | Modify | Register 4 new nodes |
| `src/lib/workflows/registry-client.ts` | Modify | Add 4 nodes to client-side registry |
| `src/lib/components/workflows/nodes/HealthQueryNode.svelte` | Create | Canvas node component |
| `src/lib/components/workflows/nodes/BlogNode.svelte` | Create | Canvas node component |
| `src/lib/components/workflows/nodes/JkaiNode.svelte` | Create | Canvas node component |
| `src/lib/components/workflows/nodes/DeepDiveNode.svelte` | Create | Canvas node component |
| `src/routes/workflows/[id]/+page.svelte` | Modify | Register 4 canvas node components |
| `tests/lib/workflows/site-tools/executor.test.ts` | Create | Tool execution tests |
| `tests/lib/workflows/site-tools/health-query-node.test.ts` | Create | Health node tests |
| `tests/lib/workflows/site-tools/blog-node.test.ts` | Create | Blog node tests |
| `tests/lib/workflows/site-tools/jkai-node.test.ts` | Create | JKAI node tests |
| `tests/lib/workflows/site-tools/deep-dive-node.test.ts` | Create | Deep Dive node tests |
