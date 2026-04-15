# JKAI Inspection & Update Tools

**Date**: 2026-04-15
**Status**: Approved

## Problem

JKAI can create, list, and delete things but cannot inspect what it has created. When a user asks "what are the steps in the workflow you just built?", jkai cannot answer. This applies across all domains: workflows, builds, research, and blog. Additionally, jkai lacks granular update capabilities — it can't tweak a single node in a workflow or adjust a build without rebuilding from scratch.

## Design Decisions

- **Approach**: Domain-scoped tool modules (Approach B from brainstorming)
- **Inspection depth**: Hybrid — summary-level inspect tools plus drill-down tools for detail
- **Update granularity**: Full surgical control — node-level, edge-level, metadata, schedules
- **Research model**: Research becomes a queryable knowledge base with branching and extraction

## Architecture

### File Structure

```
src/lib/workflows/site-tools/
├── registry.ts              (slim coordinator — register/lookup/execute/system-prompt)
├── tools/
│   ├── workflows.ts         (workflow inspect, update, runs, node executions)
│   ├── builds.ts            (build inspect, tweak, create, delete, iterations)
│   ├── research.ts          (inspect, branch, extract, query, deep-dive)
│   ├── blog.ts              (existing + unpublish)
│   ├── health.ts            (existing tools, moved here)
│   └── whatsapp.ts          (existing send, moved here)
```

### Registry Refactor

`registry.ts` becomes a slim coordinator (~80 lines):
- `ToolDefinition` interface (unchanged)
- `register()` function (unchanged)
- Public API: `getTools`, `getToolDefinitions`, `executeTool`, `isRegisteredTool`, `buildSystemPromptSection`
- Imports all `tools/*.ts` modules at top level (each module calls `register()` on import)

Home Assistant tools stay in their existing module (`src/lib/workflows/homeassistant/llm-tools.ts`) — they're already separate and wired into `general-chat.ts` independently.

---

## Domain: Workflows

### Existing Tools (moved from registry.ts)
- `workflow_create` — create from natural language description
- `workflow_list` — list workflows with name, description, schedule
- `workflow_delete` — delete by ID

### New Inspection Tools

#### `workflow_inspect`
**Purpose**: Full structural view of a workflow — what it does, how it's wired.
**Parameters**: `{ id: string }`
**Returns**: Workflow metadata (name, description, trigger config) + all nodes (id, type, label, config, position) + all edges (source, target, handles) + schedules (type, config, enabled, next run) + last 5 runs (status, trigger, timing, error).
**Category**: Workflows

#### `workflow_get_run`
**Purpose**: Drill into a specific execution run — per-node inputs, outputs, errors, timing.
**Parameters**: `{ runId: string }`
**Returns**: Run metadata (status, trigger, started/completed, error, healing history) + all node executions (nodeId, label, status, inputData, outputData, started/completed, error, logs).
**Category**: Workflows

#### `workflow_get_generation_log`
**Purpose**: Replay how the orchestrator built a workflow — the tool-calling sequence.
**Parameters**: `{ workflowId: string }`
**Returns**: The orchestrator chat messages for this workflow from `orchestrator_chats` — showing the search_nodes → use_node → connect_nodes → finalize sequence with reasoning.
**Category**: Workflows

### New Update Tools

#### `workflow_update_metadata`
**Purpose**: Rename, update description, change trigger config.
**Parameters**: `{ id: string, name?: string, description?: string, trigger?: object }`
**Returns**: Updated workflow record.
**Category**: Workflows

#### `workflow_update_node`
**Purpose**: Update a node's config, label, or type.
**Parameters**: `{ nodeId: string, config?: object, label?: string, type?: string }`
**Returns**: Updated node record.
**Category**: Workflows

#### `workflow_add_node`
**Purpose**: Add a new node to a workflow.
**Parameters**: `{ workflowId: string, type: string, label: string, config?: object, position?: { x: number, y: number } }`
**Returns**: Created node record.
**Category**: Workflows

#### `workflow_remove_node`
**Purpose**: Remove a node and its connected edges.
**Parameters**: `{ nodeId: string }`
**Returns**: Confirmation with count of removed edges.
**Category**: Workflows

#### `workflow_add_edge`
**Purpose**: Connect two nodes.
**Parameters**: `{ workflowId: string, sourceNodeId: string, targetNodeId: string, sourceHandle?: string, targetHandle?: string }`
**Returns**: Created edge record.
**Category**: Workflows

#### `workflow_remove_edge`
**Purpose**: Remove a connection between nodes.
**Parameters**: `{ edgeId: string }`
**Returns**: Confirmation.
**Category**: Workflows

#### `workflow_update_edge`
**Purpose**: Change an edge's routing (source/target handles, or reconnect to different nodes).
**Parameters**: `{ edgeId: string, sourceNodeId?: string, targetNodeId?: string, sourceHandle?: string, targetHandle?: string }`
**Returns**: Updated edge record.
**Category**: Workflows

#### `workflow_update_schedule`
**Purpose**: Enable/disable a schedule, change cron config.
**Parameters**: `{ scheduleId: string, enabled?: boolean, config?: object }`
**Returns**: Updated schedule record.
**Category**: Workflows

#### `workflow_add_schedule`
**Purpose**: Add a cron schedule to a workflow.
**Parameters**: `{ workflowId: string, type: string, config: object }`
**Returns**: Created schedule record.
**Category**: Workflows

#### `workflow_remove_schedule`
**Purpose**: Remove a schedule from a workflow.
**Parameters**: `{ scheduleId: string }`
**Returns**: Confirmation.
**Category**: Workflows

---

## Domain: Builds

### Existing Tools (moved from registry.ts)
- `jkai_start_build` — renamed to `build_create`
- `jkai_get_build` — replaced by richer `build_inspect`
- `jkai_list_builds` — renamed to `build_list`
- `jkai_control_build` — kept as `build_control` (pause/resume/stop/publish)

### New Inspection Tools

#### `build_inspect`
**Purpose**: Full build overview — status, config, iterations summary, resource usage.
**Parameters**: `{ id: string }`
**Returns**: Build record + all iterations (number, status, goals, evaluation summary, duration, tokens) + serve config + published URL if any.
**Category**: JKAI Builder

#### `build_get_iteration`
**Purpose**: Deep dive into a specific iteration — full plan, actions, messages, evaluation.
**Parameters**: `{ buildId: string, number: number }`
**Returns**: Full iteration record including goals, plan, actions array (commands executed + output), messages (LLM conversation), evaluation text, next steps, tokens used, duration.
**Category**: JKAI Builder

#### `build_get_plan`
**Purpose**: Get the planning phase (iteration 0) — the proposer/critic/reviser debate.
**Parameters**: `{ buildId: string }`
**Returns**: Iteration 0's messages array (contains the full 3-round debate), final plan text, goals.
**Category**: JKAI Builder

#### `build_get_logs`
**Purpose**: Get recent logs for a build (thinking, code, output, errors).
**Parameters**: `{ buildId: string, limit?: number, type?: string }`
**Returns**: Log entries filtered by type if specified, most recent first.
**Category**: JKAI Builder

#### `build_list_files`
**Purpose**: List files in a build's workspace (dev or live).
**Parameters**: `{ buildId: string, space?: 'dev' | 'live' }`
**Returns**: File listing from the sandbox workspace.
**Category**: JKAI Builder

#### `build_read_file`
**Purpose**: Read a specific file from a build's workspace.
**Parameters**: `{ buildId: string, path: string, space?: 'dev' | 'live' }`
**Returns**: File contents.
**Category**: JKAI Builder

### New Update Tools

#### `build_tweak`
**Purpose**: Apply a specific modification to a running or paused build — injects an instruction into the next iteration without restarting.
**Parameters**: `{ id: string, instruction: string }`
**Returns**: Confirmation. Uses the existing `continueBuild` mechanism (appends to prompt).
**Category**: JKAI Builder

#### `build_write_file`
**Purpose**: Write or update a specific file in a build's workspace.
**Parameters**: `{ buildId: string, path: string, content: string, space?: 'dev' | 'live' }`
**Returns**: Confirmation.
**Category**: JKAI Builder

#### `build_delete`
**Purpose**: Delete a build and all its iterations/logs.
**Parameters**: `{ id: string }`
**Returns**: Confirmation.
**Category**: JKAI Builder

---

## Domain: Research

### Existing Tools (moved from registry.ts)
- `research_start` — kept
- `research_status` — kept
- `research_list` — kept
- `research_get_report` — kept
- `research_control` — kept

### New Inspection Tools

#### `research_inspect`
**Purpose**: Full view of a research session — topic, goals, status, phases completed, stats, report summary.
**Parameters**: `{ id: string }`
**Returns**: Full session record with structured breakdown of what was researched and key findings summary.
**Category**: Deep Dive Research

### New Capability Tools

#### `research_query`
**Purpose**: Ask a question answered from a research session's findings. If the research doesn't contain enough information, returns a flag indicating the knowledge gap and suggests options (branch into deeper research, or do a quick web search).
**Parameters**: `{ id: string, question: string }`
**Returns**: `{ answer: string, confident: boolean, suggestions?: Array<{ type: 'branch' | 'web_search', description: string }> }`
**Implementation**: Sends the research report + question to the LLM with instructions to answer only from the research findings. If it can't answer confidently, it returns `confident: false` with suggested follow-up actions.
**Category**: Deep Dive Research

#### `research_branch`
**Purpose**: Spawn a focused follow-up research session from an existing one. Inherits context (parent topic, key findings) and digs deeper into a specific subtopic.
**Parameters**: `{ parentId: string, subtopic: string, goals?: string[] }`
**Returns**: New research session record with `parentId` reference.
**Implementation**: Creates a new research session with the parent's report as seed context. The research worker receives the parent findings so it doesn't re-cover ground.
**Category**: Deep Dive Research

#### `research_extract`
**Purpose**: Extract specific findings from research into another format — blog post draft, build prompt, workflow description, or plain summary.
**Parameters**: `{ id: string, format: 'blog_draft' | 'build_prompt' | 'workflow_description' | 'summary', focus?: string }`
**Returns**: Extracted content in the requested format, ready to be passed to the appropriate creation tool.
**Implementation**: Sends the research report to the LLM with format-specific instructions. The `focus` parameter narrows extraction to a specific finding or section.
**Category**: Deep Dive Research

#### `research_web_search`
**Purpose**: Quick grounding web search on a topic related to research, without starting a full research session. Used when jkai needs a quick fact-check or the research has a gap.
**Parameters**: `{ query: string, context?: string }`
**Returns**: Search results summary.
**Implementation**: Uses the existing web search infrastructure for a focused, short query. The `context` parameter provides framing from the research session.
**Category**: Deep Dive Research

### Schema Change

Add `parentId` column to `researchSessions` table:
```typescript
parentId: text('parent_id').references(() => researchSessions.id, { onDelete: 'set null' }),
```

---

## Domain: Blog

### Existing Tools (moved from registry.ts)
- `site_blog_list` — renamed to `blog_list`
- `site_blog_get` — renamed to `blog_get`
- `site_blog_create` — renamed to `blog_create`
- `site_blog_update` — renamed to `blog_update`

### New Tools

#### `blog_unpublish`
**Purpose**: Unpublish a blog post (set status back to draft).
**Parameters**: `{ id: string }`
**Returns**: Updated post record.
**Category**: Blog

---

## Domain: Health

### Existing Tools (moved from registry.ts, no changes)
- `site_health_stats` — renamed to `health_stats`
- `site_health_readiness` — renamed to `health_readiness`
- `site_health_sleep` — renamed to `health_sleep`
- `site_health_training_load` — renamed to `health_training_load`
- `site_health_timeline` — renamed to `health_timeline`

---

## Domain: WhatsApp

### Existing Tools (moved from registry.ts, no changes)
- `whatsapp_send` — kept as-is

---

## Tool Naming Convention

All tools follow `{domain}_{action}` pattern:
- `workflow_inspect`, `workflow_update_node`, `workflow_get_run`
- `build_inspect`, `build_get_iteration`, `build_tweak`
- `research_query`, `research_branch`, `research_extract`
- `blog_list`, `blog_unpublish`
- `health_stats`, `health_sleep`
- `whatsapp_send`

Existing `site_*` and `jkai_*` prefixes are dropped in favour of cleaner domain prefixes.

---

## Tool Count Summary

| Domain | Existing | New Inspect | New Update/Capability | Total |
|--------|----------|-------------|----------------------|-------|
| Workflows | 3 | 3 | 9 | 15 |
| Builds | 4 | 6 | 3 | 13 |
| Research | 5 | 1 | 4 | 10 |
| Blog | 4 | 0 | 1 | 5 |
| Health | 5 | 0 | 0 | 5 |
| WhatsApp | 1 | 0 | 0 | 1 |
| **Total** | **22** | **10** | **17** | **49** |

---

## Implementation Notes

### research_query Implementation
The query tool works by:
1. Loading the research session's report from DB
2. Sending to LLM: "Answer this question using ONLY the research findings below. If the findings don't contain enough information to answer confidently, say so and suggest whether a focused research branch or a quick web search would be more appropriate."
3. Parsing the LLM response for confidence and suggestions
4. Returning structured result

This keeps jkai honest — it won't hallucinate answers beyond what was actually researched.

### research_branch Implementation
1. Load parent session's report and metadata
2. Create new `researchSessions` record with `parentId` set
3. Seed the research worker with: parent topic, parent key findings, new subtopic, new goals
4. The worker avoids re-researching what the parent already covered

### build_tweak vs build_control
- `build_control` handles lifecycle (pause/resume/stop/publish)
- `build_tweak` injects specific instructions ("change the colour scheme to dark mode", "add error handling to the API calls") that get applied in the next iteration

### workflow_get_generation_log
Reads from `orchestrator_chats` where `workflowId` matches. These messages contain the full tool-calling sequence the orchestrator used when building the workflow, including its reasoning about node selection and connection logic.

### Backwards Compatibility
The old tool names (`site_blog_list`, `jkai_start_build`, etc.) are dropped. Since these tools are only used internally by the LLM and referenced in the system prompt (which is auto-generated from the registry), there's no external API to maintain.
