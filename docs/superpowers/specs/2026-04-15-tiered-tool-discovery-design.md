# Tiered Tool Discovery for JKAI Chat

**Date:** 2026-04-15
**Status:** Draft

## Problem

Every JKAI chat call sends all 52 tool schemas (~20K chars) plus the HA entity registry (~3-8K chars) to the LLM regardless of the user's intent. Asking "how did I sleep?" loads workflow graph-editing tools, build tools, blog tools, and diagnostics — none of which are relevant. This wastes tokens, increases latency, and adds noise that can confuse tool selection.

## Solution: Two-Tier Tool Architecture

Replace the flat "send everything" approach with a dynamic system where the LLM starts with just 2 meta-tools and activates specific toolsets on demand.

### Tier 1 — Always Available (2 tools)

| Tool | Purpose |
|------|---------|
| `activate_toolset` | Load a category of tools into the current conversation turn |
| `jkai_help` | Return the full capability manifest (categories, tool names, descriptions) |

These are the only tool schemas sent on every call.

### Tier 2 — On-Demand Toolsets (7 categories)

| Toolset | Tools | Description |
|---------|-------|-------------|
| `health` | health_stats, health_readiness, health_sleep, health_training_load, health_timeline | Health and fitness data |
| `blog` | blog_list, blog_get, blog_create, blog_update, blog_unpublish | Blog post management |
| `builds` | build_create, build_list, build_control, build_inspect, build_get_iteration, build_get_plan, build_get_logs, build_list_files, build_read_file, build_tweak, build_write_file, build_delete | JKAI autonomous builder |
| `research` | research_start, research_status, research_list, research_get_report, research_control, research_inspect, research_query, research_branch, research_extract, research_web_search | Deep dive research |
| `workflows` | workflow_create, workflow_list, workflow_delete, workflow_inspect, workflow_get_run, workflow_get_generation_log, workflow_update_metadata, workflow_update_node, workflow_add_node, workflow_remove_node, workflow_add_edge, workflow_remove_edge, workflow_update_edge, workflow_add_schedule, workflow_update_schedule, workflow_remove_schedule | Workflow engine |
| `home` | ha_query_state, ha_call_service, ha_fire_event, ha_get_history, ha_render_template | Home Assistant smart home |
| `whatsapp` | whatsapp_send | WhatsApp messaging |
| `diagnostics` | scheduler_status, scheduler_run_history, system_logs | System diagnostics |

### Keyword Pre-Classification

Before the LLM call, a lightweight keyword matcher runs on the user's message to pre-activate likely toolsets. This eliminates the extra round-trip for the majority of requests.

```typescript
function inferToolsets(message: string): string[] {
  const active: string[] = [];
  const lower = message.toLowerCase();

  if (/sleep|heart|readiness|train|health|hrv|recovery|workout|exercise|strain|run\b|cycling/.test(lower)) active.push('health');
  if (/blog|post|draft|publish|article|write.*about/.test(lower)) active.push('blog');
  if (/build|app|deploy|publish.*app|scaffold|create.*app/.test(lower)) active.push('builds');
  if (/research|investigate|deep.?dive|look into|find out/.test(lower)) active.push('research');
  if (/workflow|automat|schedule|trigger|cron/.test(lower)) active.push('workflows');
  if (/light|temperature|thermostat|speaker|room|house|home|blind|curtain|switch|heat|sensor|door/.test(lower)) active.push('home');
  if (/whatsapp|message|text|send.*msg/.test(lower)) active.push('whatsapp');
  if (/log|scheduler|system|debug|diagnos|service/.test(lower)) active.push('diagnostics');

  return active;
}
```

When pre-classification matches, the matched toolset schemas are included in the initial call alongside the 2 meta-tools. When it doesn't match (ambiguous or novel requests), the LLM uses `activate_toolset` or `jkai_help` to discover what it needs.

### HA Entity Registry

The entity registry (~400 entities, 3-8K chars) is no longer included in the system prompt by default. Instead:

- The system prompt mentions that smart home control is available via the `home` toolset.
- When the `home` toolset is activated (by keyword match or explicit `activate_toolset("home")`), the entity summary is returned as part of the activation response — giving the LLM the area/device context it needs.
- The HA tool schemas are loaded at the same time.

## Architecture

### Changes to `registry-internal.ts`

Add a `toolset` field to `ToolDefinition`:

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  category: string;
  toolset: string;  // new — maps to a toolset key like 'health', 'blog', etc.
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}
```

Add lookup functions:

```typescript
export function getToolsByToolset(toolset: string): ToolDefinition[] {
  return tools.filter(t => t.toolset === toolset);
}

export function getAvailableToolsets(): string[] {
  return [...new Set(tools.map(t => t.toolset))];
}
```

### Changes to `registry.ts`

Add a `getToolsetManifest()` function that returns a compact description of all toolsets and their tools (name + one-line description each). This powers the `jkai_help` meta-tool.

Add `getToolsetDefinitions(toolset: string)` that returns OpenAI-format tool schemas for a specific toolset.

### New file: `meta-tools.ts`

Defines the 2 meta-tools:

**`activate_toolset`**
- Parameters: `{ toolset: { type: 'string', enum: ['health', 'blog', 'builds', 'research', 'workflows', 'home', 'whatsapp', 'diagnostics'] } }`
- Returns: confirmation message + list of activated tool names
- Side effect: the tool dispatch loop in `general-chat.ts` merges the activated schemas into the active tools array for subsequent rounds

**`jkai_help`**
- Parameters: `{ category?: string }` (optional filter)
- Returns: the full capability manifest — toolset names, tool names, and brief descriptions
- No side effect — purely informational

### Changes to `general-chat.ts`

The main chat loop changes:

1. **System prompt**: Remove the HA entity section and the site capabilities section. Replace with a compact capability summary (~300 chars) that lists toolset names and instructs the LLM to use `activate_toolset` or `jkai_help`.

2. **Tool assembly**: Replace the flat `allTools` array with a mutable `activeTools` set. Initialize with:
   - The 2 meta-tool schemas (always)
   - Any toolset schemas matched by `inferToolsets(userMessage)` (pre-classification)

3. **Tool dispatch loop**: When `activate_toolset` is called:
   - Look up the requested toolset's schemas via `getToolsetDefinitions(toolset)`
   - Merge them into `activeTools`
   - For the `home` toolset, also include the HA entity summary in the tool result
   - Return confirmation to the LLM
   - On the next iteration, pass the expanded `activeTools` to `client.chat.completions.create()`

4. **HA dispatch**: The switch/case for `ha_*` tools stays the same — those tools just aren't in the schema until the `home` toolset is activated.

### Changes to `llm-tools.ts` (site)

Replace the single `SITE_TOOL_DEFINITIONS` export with:
- `META_TOOL_DEFINITIONS` — the 2 meta-tools
- `getToolsetDefinitions(toolset)` — returns schemas for a specific toolset

### Changes to `llm-tools.ts` (HA)

`HA_TOOL_DEFINITIONS` stays as-is but is no longer exported for default inclusion. It's loaded on demand when the `home` toolset is activated.

`buildHASystemPromptSection()` is no longer called during system prompt assembly. The entity summary is returned as part of `activate_toolset("home")` instead.

### System Prompt Changes

Current system prompt ends with:
```
--- Site Capabilities ---
You have access to the following tools on the user's personal platform...
**Health Data** (health_stats, health_readiness, ...)
**Blog** (blog_list, blog_get, ...)
...

--- Home Assistant Smart Home ---
You can control the smart home using ha_* functions. Available areas and devices:
Living Room: 5 lights, 2 sensors...
...
```

New system prompt ending:
```
--- Capabilities ---
You have toolsets available: health, blog, builds, research, workflows, home, whatsapp, diagnostics.
Use activate_toolset(name) to load tools for a domain. Use jkai_help() to see what's available.
When tools are pre-loaded for you, use them directly without activation.
```

## Context Savings

| Component | Before | After (typical) |
|-----------|--------|-----------------|
| Tool schemas | 52 tools (~20K chars) | 2 meta-tools (~1K) + 0-1 activated set (~2-5K) |
| HA entity registry | 3-8K chars always | 0 (loaded on demand via home toolset) |
| System prompt capability section | ~400 chars | ~250 chars |
| **Total tool overhead** | **~24-28K chars** | **~1.5-6K chars** |

Estimated **75-95% reduction** in tool context per call.

## Trade-offs

**Costs:**
- Messages that don't match any keyword pattern require an extra tool round (1 additional LLM call) for the LLM to activate what it needs
- Multi-domain requests (e.g., "check my sleep and turn off the bedroom lights") need 2 activations in the same round, using up 1 of the 5 tool rounds
- The keyword classifier could miss intent — but `jkai_help` + `activate_toolset` are the safety net

**Mitigations:**
- The keyword classifier handles the common cases, so extra round-trips are rare
- The LLM can call `activate_toolset` multiple times in a single tool round (parallel tool calls)
- If option C proves too aggressive, we can promote high-frequency tools to Tier 1 later

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/workflows/site-tools/registry-internal.ts` | Add `toolset` field, lookup functions |
| `src/lib/workflows/site-tools/registry.ts` | Add `getToolsetManifest()`, `getToolsetDefinitions()`, update `buildSystemPromptSection()` |
| `src/lib/workflows/site-tools/tools/*.ts` | Add `toolset` field to each `register()` call |
| `src/lib/workflows/site-tools/llm-tools.ts` | Replace flat exports with meta-tool + toolset exports |
| `src/lib/workflows/site-tools/meta-tools.ts` | New — meta-tool definitions and handlers |
| `src/lib/workflows/homeassistant/llm-tools.ts` | Keep definitions, remove default export pattern |
| `src/lib/workflows/chat/general-chat.ts` | Tiered tool assembly, keyword pre-classification, dynamic activation in dispatch loop |

## Not in Scope

- Embedding-based tool retrieval (over-engineered for 52 tools across 8 categories)
- Two-call routing with a separate classifier model (adds latency)
- Conversation-level tool caching across turns (optimisation for later if needed)
- Changes to the builder agent pipeline (separate system, different LLM context)
