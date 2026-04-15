# Tiered Tool Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce JKAI chat context by 75-95% through dynamic tool loading — 2 meta-tools always available, 8 toolsets loaded on demand.

**Architecture:** Replace the flat tool array in `general-chat.ts` with a tiered system. Every `register()` call gains a `toolset` field. Two meta-tools (`activate_toolset`, `jkai_help`) are always sent. A keyword pre-classifier on the user message auto-activates likely toolsets before the LLM call. The LLM can activate additional toolsets mid-conversation via `activate_toolset`. The HA entity registry moves from the system prompt to the `home` toolset activation response.

**Tech Stack:** TypeScript, SvelteKit, OpenAI-compatible chat completions API

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/workflows/site-tools/registry-internal.ts` | Core types + `toolset` field, toolset lookup helpers |
| `src/lib/workflows/site-tools/tools/health.ts` | Add `toolset: 'health'` to each register call |
| `src/lib/workflows/site-tools/tools/blog.ts` | Add `toolset: 'blog'` to each register call |
| `src/lib/workflows/site-tools/tools/builds.ts` | Add `toolset: 'builds'` to each register call |
| `src/lib/workflows/site-tools/tools/research.ts` | Add `toolset: 'research'` to each register call |
| `src/lib/workflows/site-tools/tools/workflows.ts` | Add `toolset: 'workflows'` to each register call |
| `src/lib/workflows/site-tools/tools/whatsapp.ts` | Add `toolset: 'whatsapp'` to each register call |
| `src/lib/workflows/site-tools/tools/diagnostics.ts` | Add `toolset: 'diagnostics'` to each register call |
| `src/lib/workflows/site-tools/registry.ts` | Add `getToolsetManifest()`, `getToolsetDefinitions()`, simplify `buildSystemPromptSection()` |
| `src/lib/workflows/site-tools/meta-tools.ts` | **New** — `activate_toolset` and `jkai_help` definitions + handlers |
| `src/lib/workflows/site-tools/llm-tools.ts` | Replace flat `SITE_TOOL_DEFINITIONS` with `META_TOOL_DEFINITIONS` + `getToolsetDefinitions()` |
| `src/lib/workflows/site-tools/keyword-classifier.ts` | **New** — `inferToolsets(message)` function |
| `src/lib/workflows/homeassistant/llm-tools.ts` | Keep tool defs, remove from default inclusion, entity summary returned on activation |
| `src/lib/workflows/chat/general-chat.ts` | Tiered assembly, keyword pre-classification, dynamic activation in dispatch loop |
| `data/prompts/02-capabilities.md` | Simplify to reference toolsets instead of listing all tools |
| `data/prompts/03-tools.md` | Update tool guidance for tiered system |

---

### Task 1: Add `toolset` field to registry internals

**Files:**
- Modify: `src/lib/workflows/site-tools/registry-internal.ts`

- [ ] **Step 1: Add `toolset` to `ToolDefinition` interface and add lookup helpers**

```typescript
// registry-internal.ts — full replacement
export type ToolResult = { success: boolean; data?: unknown; error?: string };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  category: string;
  toolset: string;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export const tools: ToolDefinition[] = [];

export function register(tool: ToolDefinition) {
  tools.push(tool);
}

export function getToolsByToolset(toolset: string): ToolDefinition[] {
  return tools.filter((t) => t.toolset === toolset);
}

export function getAvailableToolsets(): string[] {
  return [...new Set(tools.map((t) => t.toolset))];
}
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `cd ~/strange_rambling_svelte && npx tsc --noEmit 2>&1 | head -30`

Expected: Type errors in all `register()` call sites because `toolset` is now required. This is expected — we'll fix them in Task 2.

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/site-tools/registry-internal.ts
git commit -m "feat(jkai): add toolset field to ToolDefinition interface"
```

---

### Task 2: Add `toolset` to all tool registration calls

**Files:**
- Modify: `src/lib/workflows/site-tools/tools/health.ts`
- Modify: `src/lib/workflows/site-tools/tools/blog.ts`
- Modify: `src/lib/workflows/site-tools/tools/builds.ts`
- Modify: `src/lib/workflows/site-tools/tools/research.ts`
- Modify: `src/lib/workflows/site-tools/tools/workflows.ts`
- Modify: `src/lib/workflows/site-tools/tools/whatsapp.ts`
- Modify: `src/lib/workflows/site-tools/tools/diagnostics.ts`

- [ ] **Step 1: Add `toolset: 'health'` to all health tool registrations**

In `tools/health.ts`, add `toolset: 'health',` to each `register()` call. There are 5 tools. Add the field after `category`:

```typescript
// For each register() call in health.ts, add after the category line:
  toolset: 'health',
```

The 5 tools: `health_stats`, `health_readiness`, `health_sleep`, `health_training_load`, `health_timeline`.

- [ ] **Step 2: Add `toolset: 'blog'` to all blog tool registrations**

In `tools/blog.ts`, add `toolset: 'blog',` to each `register()` call (5 tools: `blog_list`, `blog_get`, `blog_create`, `blog_update`, `blog_unpublish`).

- [ ] **Step 3: Add `toolset: 'builds'` to all build tool registrations**

In `tools/builds.ts`, add `toolset: 'builds',` to each `register()` call (12 tools: `build_create`, `build_list`, `build_control`, `build_inspect`, `build_get_iteration`, `build_get_plan`, `build_get_logs`, `build_list_files`, `build_read_file`, `build_tweak`, `build_write_file`, `build_delete`).

- [ ] **Step 4: Add `toolset: 'research'` to all research tool registrations**

In `tools/research.ts`, add `toolset: 'research',` to each `register()` call (10 tools: `research_start`, `research_status`, `research_list`, `research_get_report`, `research_control`, `research_inspect`, `research_query`, `research_branch`, `research_extract`, `research_web_search`).

- [ ] **Step 5: Add `toolset: 'workflows'` to all workflow tool registrations**

In `tools/workflows.ts`, add `toolset: 'workflows',` to each `register()` call (16 tools: `workflow_create`, `workflow_list`, `workflow_delete`, `workflow_inspect`, `workflow_get_run`, `workflow_get_generation_log`, `workflow_update_metadata`, `workflow_update_node`, `workflow_add_node`, `workflow_remove_node`, `workflow_add_edge`, `workflow_remove_edge`, `workflow_update_edge`, `workflow_add_schedule`, `workflow_update_schedule`, `workflow_remove_schedule`).

- [ ] **Step 6: Add `toolset: 'whatsapp'` to whatsapp tool registration**

In `tools/whatsapp.ts`, add `toolset: 'whatsapp',` to the single `register()` call.

- [ ] **Step 7: Add `toolset: 'diagnostics'` to all diagnostics tool registrations**

In `tools/diagnostics.ts`, add `toolset: 'diagnostics',` to each `register()` call (3 tools: `scheduler_status`, `scheduler_run_history`, `system_logs`).

- [ ] **Step 8: Verify the project type-checks cleanly**

Run: `cd ~/strange_rambling_svelte && npx tsc --noEmit 2>&1 | head -10`

Expected: No errors (or only pre-existing unrelated errors).

- [ ] **Step 9: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/site-tools/tools/
git commit -m "feat(jkai): add toolset field to all tool registrations"
```

---

### Task 3: Create the keyword classifier

**Files:**
- Create: `src/lib/workflows/site-tools/keyword-classifier.ts`

- [ ] **Step 1: Create the keyword classifier module**

```typescript
// src/lib/workflows/site-tools/keyword-classifier.ts

const TOOLSET_PATTERNS: Array<{ toolset: string; pattern: RegExp }> = [
  { toolset: 'health', pattern: /sleep|heart|readiness|train(?:ing)?|health|hrv|recovery|workout|exercise|strain|\brun\b|\bruns\b|cycling|fitness|activity|strava/i },
  { toolset: 'blog', pattern: /blog|post|draft|publish|article|write\s+about/i },
  { toolset: 'builds', pattern: /build|app|deploy|publish\s*app|scaffold|create\s*app/i },
  { toolset: 'research', pattern: /research|investigate|deep\s*dive|look\s+into|find\s+out/i },
  { toolset: 'workflows', pattern: /workflow|automat|schedule|trigger|cron/i },
  { toolset: 'home', pattern: /light|temperature|thermostat|speaker|room|house|home|blind|curtain|switch(?:es)?|heat(?:ing)?|sensor|door|camera|ring|alexa|tado|hue|media\s*player|tv\b|bravia/i },
  { toolset: 'whatsapp', pattern: /whatsapp|message|text\s+me|send\s*(me\s+)?a?\s*msg|notify\s+me/i },
  { toolset: 'diagnostics', pattern: /\blog\b|logs|scheduler|system\s+(status|health|check)|debug|diagnos|service|journal/i },
];

export function inferToolsets(message: string): string[] {
  const matched: string[] = [];
  for (const { toolset, pattern } of TOOLSET_PATTERNS) {
    if (pattern.test(message)) {
      matched.push(toolset);
    }
  }
  return matched;
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/site-tools/keyword-classifier.ts
git commit -m "feat(jkai): add keyword classifier for toolset pre-activation"
```

---

### Task 4: Update the registry public API

**Files:**
- Modify: `src/lib/workflows/site-tools/registry.ts`

- [ ] **Step 1: Add toolset manifest and definition functions, update system prompt builder**

Replace the full contents of `registry.ts`:

```typescript
// Tool Registry — Slim Coordinator
// Types and register() live in registry-internal.ts to avoid circular init with domain modules.

export { register } from './registry-internal';
export type { ToolDefinition, ToolResult } from './registry-internal';
import { tools, getToolsByToolset, getAvailableToolsets } from './registry-internal';
import type { ToolResult } from './registry-internal';

// --- Load all domain modules (each calls register() on import) ---
import './tools/health';
import './tools/blog';
import './tools/builds';
import './tools/research';
import './tools/whatsapp';
import './tools/workflows';
import './tools/diagnostics';

// --- Public API ---

export function getTools() {
  return tools as readonly (typeof tools)[number][];
}

/** Get OpenAI-format tool definitions for ALL registered tools (used by workflow engine, not general chat) */
export function getToolDefinitions() {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Get OpenAI-format tool definitions for a specific toolset */
export function getToolsetDefinitions(toolset: string) {
  return getToolsByToolset(toolset).map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Compact manifest of all toolsets — category, tool names, and one-line descriptions */
export function getToolsetManifest(): Array<{
  toolset: string;
  description: string;
  tools: Array<{ name: string; description: string }>;
}> {
  const toolsetDescriptions: Record<string, string> = {
    health: 'Health & fitness data — weekly stats, readiness, sleep, training load, timeline',
    blog: 'Blog post management — list, create, update, publish/unpublish',
    builds: 'JKAI autonomous builder — create, monitor, control, inspect, publish builds',
    research: 'Deep dive research — start sessions, get reports, query findings, web search',
    workflows: 'Workflow automation — create, inspect, edit nodes/edges/schedules',
    home: 'Home Assistant smart home — query state, control devices, history, templates',
    whatsapp: 'WhatsApp messaging — send messages and notifications',
    diagnostics: 'System diagnostics — scheduler status, run history, service logs',
  };

  return getAvailableToolsets().map((ts) => ({
    toolset: ts,
    description: toolsetDescriptions[ts] || ts,
    tools: getToolsByToolset(ts).map((t) => ({
      name: t.name,
      description: t.description,
    })),
  }));
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { success: false, error: `Unknown tool: ${name}` };
  try {
    return await tool.handler(args);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export function isRegisteredTool(name: string): boolean {
  return tools.some((t) => t.name === name);
}

/** Compact system prompt section — lists toolsets, not individual tools */
export function buildSystemPromptSection(): string {
  const toolsets = getAvailableToolsets();
  return `\n\n--- Capabilities ---\nYou have toolsets available: ${toolsets.join(', ')}.\nUse activate_toolset(name) to load tools for a domain. Use jkai_help() to see what's available in each toolset.\nWhen tools are pre-loaded for you, use them directly — no activation needed.\n\nJohn's WhatsApp number: +447359228511`;
}

// Re-export toolset helpers for use by meta-tools and general-chat
export { getToolsByToolset, getAvailableToolsets };
```

- [ ] **Step 2: Verify type-check**

Run: `cd ~/strange_rambling_svelte && npx tsc --noEmit 2>&1 | head -10`

Expected: Clean or only pre-existing errors.

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/site-tools/registry.ts
git commit -m "feat(jkai): add toolset manifest and definition APIs to registry"
```

---

### Task 5: Create the meta-tools module

**Files:**
- Create: `src/lib/workflows/site-tools/meta-tools.ts`

- [ ] **Step 1: Create the meta-tools module with `activate_toolset` and `jkai_help`**

```typescript
// src/lib/workflows/site-tools/meta-tools.ts

import { getToolsetManifest, getAvailableToolsets } from './registry';

const TOOLSET_NAMES = [
  'health', 'blog', 'builds', 'research',
  'workflows', 'home', 'whatsapp', 'diagnostics',
] as const;

export const META_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'activate_toolset',
      description:
        'Load a category of tools into the current conversation. Call this before using domain-specific tools. You can activate multiple toolsets by calling this multiple times in the same turn.',
      parameters: {
        type: 'object',
        properties: {
          toolset: {
            type: 'string',
            enum: TOOLSET_NAMES,
            description: 'The toolset to activate',
          },
        },
        required: ['toolset'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'jkai_help',
      description:
        'See what capabilities and tools are available. Returns all toolsets with their tool names and descriptions. Use this when unsure which toolset to activate.',
      parameters: {
        type: 'object',
        properties: {
          toolset: {
            type: 'string',
            enum: TOOLSET_NAMES,
            description: 'Optional: filter to a specific toolset for detailed info',
          },
        },
      },
    },
  },
];

export function handleJkaiHelp(args: Record<string, unknown>): {
  success: boolean;
  data: unknown;
} {
  const toolset = args.toolset as string | undefined;
  const manifest = getToolsetManifest();

  if (toolset) {
    const entry = manifest.find((m) => m.toolset === toolset);
    if (!entry) {
      return {
        success: false,
        data: {
          error: `Unknown toolset: ${toolset}`,
          available: getAvailableToolsets(),
        },
      };
    }
    return { success: true, data: entry };
  }

  return { success: true, data: manifest };
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/site-tools/meta-tools.ts
git commit -m "feat(jkai): create meta-tools module (activate_toolset, jkai_help)"
```

---

### Task 6: Update `llm-tools.ts` exports

**Files:**
- Modify: `src/lib/workflows/site-tools/llm-tools.ts`

- [ ] **Step 1: Replace flat exports with meta-tool + toolset exports**

```typescript
// src/lib/workflows/site-tools/llm-tools.ts

import { getToolDefinitions, buildSystemPromptSection, getToolsetDefinitions } from './registry';
import { META_TOOL_DEFINITIONS } from './meta-tools';

/** All tool definitions — used by workflow orchestrator (not general chat) */
export const SITE_TOOL_DEFINITIONS = getToolDefinitions();

/** Meta-tools only — used by general chat as the always-available base */
export { META_TOOL_DEFINITIONS };

/** Get tool definitions for a specific toolset — used by general chat for dynamic activation */
export { getToolsetDefinitions };

export { buildSystemPromptSection as buildSiteSystemPromptSection };
```

- [ ] **Step 2: Verify type-check**

Run: `cd ~/strange_rambling_svelte && npx tsc --noEmit 2>&1 | head -10`

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/site-tools/llm-tools.ts
git commit -m "feat(jkai): export meta-tools and toolset definitions from llm-tools"
```

---

### Task 7: Rewrite `general-chat.ts` with tiered tool loading

This is the core change. The chat loop now:
1. Starts with only meta-tools + keyword-pre-activated toolsets
2. Handles `activate_toolset` by dynamically expanding the tool array
3. No longer includes HA entity registry in the system prompt

**Files:**
- Modify: `src/lib/workflows/chat/general-chat.ts`

- [ ] **Step 1: Rewrite general-chat.ts with tiered tool loading**

```typescript
// src/lib/workflows/chat/general-chat.ts — full replacement

import { db } from '$lib/db';
import { homeAssistantConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';
import { HA_TOOL_DEFINITIONS, buildHASystemPromptSection } from '$lib/workflows/homeassistant/llm-tools';
import { META_TOOL_DEFINITIONS, getToolsetDefinitions } from '$lib/workflows/site-tools/llm-tools';
import { executeSiteTool, isRegisteredTool } from '$lib/workflows/site-tools/executor';
import { handleJkaiHelp } from '$lib/workflows/site-tools/meta-tools';
import { getCompiledPrompt } from '$lib/workflows/prompts/loader';
import { inferToolsets } from '$lib/workflows/site-tools/keyword-classifier';
import { buildSystemPromptSection } from '$lib/workflows/site-tools/registry';

const MAX_HISTORY = 30;
const MAX_TOOL_ROUNDS = 5;

interface ChatOptions {
  workflowId?: string | null;
  onProgress?: (text: string) => void;
}

export async function generalChat(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  options: ChatOptions = {},
): Promise<{ response: string }> {
  const { onProgress } = options;

  // Load HA entity context (needed to know if HA is available)
  let haEntities: any[] = [];
  try {
    const [haConfig] = await db
      .select()
      .from(homeAssistantConfig)
      .where(eq(homeAssistantConfig.id, 'default'))
      .limit(1);
    if (haConfig?.token && Array.isArray(haConfig.entityRegistry)) {
      haEntities = haConfig.entityRegistry as any[];
    }
  } catch {}

  // Build system prompt — no longer includes HA entity registry or full tool list
  const basePrompt = await getCompiledPrompt();
  const siteSection = buildSystemPromptSection();
  const systemContent = `${basePrompt}${siteSection}`;

  // Build messages
  const messages: Array<any> = [
    { role: 'system', content: systemContent },
  ];

  const recentHistory = conversationHistory.slice(-MAX_HISTORY);
  for (const h of recentHistory) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: userMessage });

  // --- Tiered tool assembly ---
  // Always include meta-tools
  const activeTools: Array<any> = [...META_TOOL_DEFINITIONS];
  const activatedToolsets = new Set<string>();

  // Keyword pre-classification: auto-activate likely toolsets
  const inferred = inferToolsets(userMessage);
  for (const ts of inferred) {
    if (ts === 'home') {
      // For home toolset, also add HA tools if entities are available
      if (haEntities.length > 0) {
        activeTools.push(...HA_TOOL_DEFINITIONS);
        activatedToolsets.add('home');
      }
    } else {
      activeTools.push(...getToolsetDefinitions(ts));
      activatedToolsets.add(ts);
    }
  }

  const client = getOpenAIClient();
  const model = getModel();
  let responseText = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const tools = activeTools.length > 0 ? activeTools : undefined;

    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await client.chat.completions.create({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 2048,
          ...(tools ? { tools } : {}),
        });
        break;
      } catch (err: any) {
        if (err?.status === 429 && attempt < 2) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
          continue;
        }
        throw err;
      }
    }

    const choice = response?.choices[0];
    if (!choice) {
      console.warn('[general-chat] No choice in LLM response');
      break;
    }

    const msg = choice.message;

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      responseText = msg.content?.trim() || "Sorry, I couldn't generate a response.";
      break;
    }

    // Process tool calls
    messages.push(msg);
    onProgress?.(`Using tools...\n`);

    let toolsetsActivatedThisRound = false;

    for (const toolCall of msg.tool_calls) {
      const fnName = toolCall.function.name;
      let fnArgs: Record<string, unknown>;
      try {
        fnArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: 'Invalid JSON arguments' }) });
        continue;
      }

      let toolResult: any;

      // Handle meta-tools
      if (fnName === 'activate_toolset') {
        const toolset = fnArgs.toolset as string;
        if (activatedToolsets.has(toolset)) {
          toolResult = { success: true, data: { toolset, status: 'already_active', message: `${toolset} tools are already loaded.` } };
        } else if (toolset === 'home') {
          if (haEntities.length > 0) {
            activeTools.push(...HA_TOOL_DEFINITIONS);
            activatedToolsets.add('home');
            const entitySummary = buildHASystemPromptSection(haEntities);
            toolResult = {
              success: true,
              data: {
                toolset: 'home',
                status: 'activated',
                tools: HA_TOOL_DEFINITIONS.map((t) => t.function.name),
                entityContext: entitySummary,
              },
            };
          } else {
            toolResult = { success: false, error: 'Home Assistant is not configured — no entities available.' };
          }
        } else {
          const defs = getToolsetDefinitions(toolset);
          if (defs.length === 0) {
            toolResult = { success: false, error: `Unknown toolset: ${toolset}` };
          } else {
            activeTools.push(...defs);
            activatedToolsets.add(toolset);
            toolResult = {
              success: true,
              data: {
                toolset,
                status: 'activated',
                tools: defs.map((d) => d.function.name),
              },
            };
          }
        }
        toolsetsActivatedThisRound = true;
      } else if (fnName === 'jkai_help') {
        toolResult = handleJkaiHelp(fnArgs);
      } else {
        // Handle HA tools
        const haService = getHomeAssistantService();
        switch (fnName) {
          case 'ha_query_state':
            toolResult = await haService.queryState(fnArgs.entity_id as string);
            break;
          case 'ha_call_service':
            toolResult = await haService.callService(
              fnArgs.domain as string,
              fnArgs.service as string,
              fnArgs.entity_id as string | undefined,
              fnArgs.data as Record<string, unknown> | undefined,
            );
            break;
          case 'ha_fire_event':
            toolResult = await haService.fireEvent(
              fnArgs.event_type as string,
              fnArgs.data as Record<string, unknown> | undefined,
            );
            break;
          case 'ha_get_history':
            toolResult = await haService.getHistory(
              fnArgs.entity_id as string,
              fnArgs.start as string | undefined,
              fnArgs.end as string | undefined,
            );
            break;
          case 'ha_render_template':
            toolResult = await haService.renderTemplate(fnArgs.template as string);
            break;
          default:
            if (isRegisteredTool(fnName)) {
              toolResult = await executeSiteTool(fnName, fnArgs);
            } else {
              toolResult = { error: `Unknown function: ${fnName}` };
            }
        }
      }

      onProgress?.(`${fnName}: done\n`);
      // Truncate large tool results to avoid overwhelming the LLM context
      let resultStr = JSON.stringify(toolResult);
      if (resultStr.length > 8000) {
        resultStr = resultStr.slice(0, 8000) + '... [truncated — result too large for chat context]';
      }
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: resultStr,
      });
    }
  }

  if (!responseText) {
    responseText = "Sorry, I couldn't generate a response.";
  }

  return { response: responseText };
}
```

- [ ] **Step 2: Verify type-check**

Run: `cd ~/strange_rambling_svelte && npx tsc --noEmit 2>&1 | head -10`

Expected: Clean.

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/chat/general-chat.ts
git commit -m "feat(jkai): rewrite general-chat with tiered tool loading"
```

---

### Task 8: Update system prompt files

The prompt files currently reference specific tool function names (e.g. `ha_* functions`, `site_health_* functions`). Update them to reference toolsets instead, and trim the verbose capability listings since the LLM will discover tools dynamically.

**Files:**
- Modify: `data/prompts/02-capabilities.md`
- Modify: `data/prompts/03-tools.md`

- [ ] **Step 1: Simplify `02-capabilities.md`**

```markdown
# Capabilities

You are deeply integrated with your user's personal platform (strangeramblings.com) and home infrastructure. Your capabilities are organised into toolsets — activate the ones you need.

## Available Toolsets

- **health** — Strava activities, Apple Watch metrics, weekly stats, readiness scores, sleep analysis, training load
- **blog** — Full blog CMS with drafts and publishing (markdown/HTML)
- **builds** — JKAI autonomous code builder — create, monitor, control, inspect, publish web apps
- **research** — Multi-phase AI research with source credibility scoring and narrative building
- **whatsapp** — Send messages and notifications via WhatsApp. John's number: +447359228511
- **workflows** — Create automated workflows from natural language. Supports cron schedules, HA control, WhatsApp, LLM calls, code execution, and more
- **home** — Home Assistant: 400+ entities across 13 areas (Hue lights, Tado climate, Ring cameras, Sony TVs, Alexa)
- **diagnostics** — Scheduler status, workflow run history, systemd service logs
```

- [ ] **Step 2: Update `03-tools.md`**

```markdown
# Tool Usage Guide

## How Tools Work
Your tools are organised into toolsets. Relevant toolsets are often pre-loaded based on what you're asked about. If you need tools from a domain that isn't loaded, call `activate_toolset(name)`. Call `jkai_help()` if you're unsure what's available.

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
- health_readiness gives the most useful daily snapshot.
- health_stats for weekly summaries and personal records.
- health_sleep for sleep quality details.

## Blog
- Always list posts before trying to get/update a specific one.
- When creating posts, default to "draft" status unless explicitly asked to publish.

## JKAI Builder
- Builds are asynchronous — start returns immediately, check status later.
- Don't publish builds without being asked.

## Research
- Research sessions take time (minutes). Start and check back.
- Use "standard" depth unless the user asks for more/less.

## WhatsApp
- John's number: +447359228511
- Use for alerts, notifications, or when the user asks you to message them.
- Don't send unsolicited messages unless you've been asked to set up an alert.

## Workflows
- Use workflow_create when the user needs something automated, recurring, or event-driven.
- The workflow engine handles ongoing automation — build it once and it runs on its own.
- Prefer workflow_create over one-off tool calls when the request implies continuous or repeated behaviour.
- After creating a workflow, always share the review link as a clickable markdown link.
- Use workflow_list to check what exists before creating duplicates.
```

- [ ] **Step 3: Sync prompts to DB**

Run: `cd ~/strange_rambling_svelte && node -e "import('$lib/workflows/prompts/loader').then(m => m.syncPrompts())"`

If that doesn't work with ESM, the prompts will sync on next app restart. That's fine — note it for verification.

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add data/prompts/02-capabilities.md data/prompts/03-tools.md
git commit -m "feat(jkai): update system prompts for tiered tool discovery"
```

---

### Task 9: Verify the full system works end-to-end

**Files:** None (testing only)

- [ ] **Step 1: Type-check the whole project**

Run: `cd ~/strange_rambling_svelte && npx tsc --noEmit 2>&1 | tail -5`

Expected: Clean or only pre-existing errors.

- [ ] **Step 2: Build the project**

Run: `cd ~/strange_rambling_svelte && npm run build 2>&1 | tail -20`

Expected: Build succeeds.

- [ ] **Step 3: Start the dev server and test via the JKAI chat**

Run: `cd ~/strange_rambling_svelte && npm run dev`

Test these scenarios in the browser at `http://homeserv:5173/jkai`:

1. **Health query** — "how did I sleep last night?" → should pre-activate `health` toolset via keyword match, use `health_sleep` directly
2. **HA control** — "turn off the living room lights" → should pre-activate `home` toolset, use `ha_call_service`
3. **Ambiguous query** — "what can you do?" → should use `jkai_help` meta-tool
4. **Multi-domain** — "check my readiness and create a workflow to send me a morning health summary" → should pre-activate both `health` and `workflows`
5. **No match** — "hello, how are you?" → should respond conversationally without activating any toolsets

- [ ] **Step 4: Verify context size reduction**

Add a temporary log to `general-chat.ts` at the start of the tool dispatch loop:

```typescript
console.log(`[general-chat] Active tools: ${activeTools.length}, toolsets: ${[...activatedToolsets].join(', ') || 'none'}`);
```

Run several queries and check the server logs. Expected:
- Conversational messages: 2 tools (meta-tools only)
- Health questions: ~7 tools (2 meta + 5 health)
- HA questions: ~7 tools (2 meta + 5 HA)
- Ambiguous: 2 tools initially, then more after activation

Remove the temporary log after verification.

- [ ] **Step 5: Commit any fixes found during testing**

```bash
cd ~/strange_rambling_svelte
git add -A
git commit -m "fix(jkai): address issues found during tiered tool discovery testing"
```

Only run this if changes were needed. Skip if testing passed cleanly.
