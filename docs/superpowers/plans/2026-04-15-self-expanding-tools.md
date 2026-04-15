# Self-Expanding Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow JKAI to create, register, persist, and call new tools at runtime when it encounters capability gaps.

**Architecture:** A `custom_tools` DB table stores tool definitions (name, parameters, handler JS code). On startup, persisted tools are loaded into the existing registry via `register()`. A new `create_tool` meta-tool lets JKAI define tools mid-conversation, which are registered immediately and persisted for future sessions. The system prompt instructs JKAI to propose tools before creating them.

**Tech Stack:** Drizzle ORM (PostgreSQL), existing site-tools registry, `AsyncFunction` constructor for handler evaluation

**Spec:** `docs/superpowers/specs/2026-04-15-self-expanding-tools-design.md`

---

### Task 1: Add `custom_tools` DB table

**Files:**
- Modify: `src/lib/db/schema.ts` (append after line 763)

- [ ] **Step 1: Add the table definition**

Add to the end of `src/lib/db/schema.ts`, before the closing exports:

```typescript
// ==========================================
// Custom Tools (JKAI self-expanding)
// ==========================================

export const customTools = pgTable('custom_tools', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  toolset: text('toolset').notNull(),
  parameters: jsonb('parameters').notNull().default(sql`'{"type":"object","properties":{}}'::jsonb`),
  handlerCode: text('handler_code').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type CustomTool = typeof customTools.$inferSelect;
```

- [ ] **Step 2: Push schema to DB**

Run: `cd ~/strange_rambling_svelte && npx drizzle-kit push`
Expected: Table `custom_tools` created successfully.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat: add custom_tools table for JKAI self-expanding tools"
```

---

### Task 2: Create custom tool loader

**Files:**
- Create: `src/lib/workflows/site-tools/custom-tool-loader.ts`

- [ ] **Step 1: Create the loader module**

```typescript
// src/lib/workflows/site-tools/custom-tool-loader.ts

import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { register } from './registry-internal';

/**
 * Wraps handler_code string into a callable async function.
 * The handler receives `args` (tool arguments) and `fetch` (global fetch).
 * Must return { success: boolean, data?: unknown, error?: string }.
 */
function buildHandler(name: string, code: string): (args: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }> {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('args', 'fetch', code) as (
    args: Record<string, unknown>,
    fetch: typeof globalThis.fetch,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;

  return async (args: Record<string, unknown>) => {
    try {
      return await fn(args, globalThis.fetch);
    } catch (err) {
      return { success: false, error: `Custom tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  };
}

/**
 * Load all enabled custom tools from DB and register them.
 * Called once on startup after static tools are registered.
 */
export async function loadCustomTools(): Promise<number> {
  let rows;
  try {
    rows = await db.select().from(customTools).where(eq(customTools.enabled, true));
  } catch {
    // Table may not exist yet on first run
    console.warn('[custom-tools] Table not found — skipping');
    return 0;
  }

  let loaded = 0;
  for (const row of rows) {
    try {
      register({
        name: row.name,
        description: row.description,
        toolset: row.toolset,
        parameters: row.parameters as { type: 'object'; properties: Record<string, unknown>; required?: string[] },
        category: 'Custom Tool',
        handler: buildHandler(row.name, row.handlerCode),
      });
      loaded++;
    } catch (err) {
      console.error(`[custom-tools] Failed to load "${row.name}":`, err instanceof Error ? err.message : err);
    }
  }

  if (loaded > 0) {
    console.log(`[custom-tools] Loaded ${loaded} custom tool(s)`);
  }
  return loaded;
}

export { buildHandler };
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/workflows/site-tools/custom-tool-loader.ts
git commit -m "feat: add custom tool loader — loads persisted tools from DB on startup"
```

---

### Task 3: Load custom tools on startup

**Files:**
- Modify: `src/lib/workflows/index.ts`

- [ ] **Step 1: Add loadCustomTools call alongside syncPrompts**

In `src/lib/workflows/index.ts`, add the import at the top with the other imports:

```typescript
import { loadCustomTools } from './site-tools/custom-tool-loader';
```

Then add the startup call right after the `syncPrompts()` call (after line 174):

```typescript
loadCustomTools().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : 'Unknown error';
  console.error('[custom-tools] Load failed:', msg);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/workflows/index.ts
git commit -m "feat: load custom tools on workflow engine startup"
```

---

### Task 4: Add `create_tool` and `list_custom_tools` meta-tools

**Files:**
- Modify: `src/lib/workflows/site-tools/meta-tools.ts`

- [ ] **Step 1: Add the tool definitions to META_TOOL_DEFINITIONS**

In `meta-tools.ts`, add two new entries to the `META_TOOL_DEFINITIONS` array after the `jkai_help` entry:

```typescript
  {
    type: 'function' as const,
    function: {
      name: 'create_tool',
      description:
        'Create and register a new tool at runtime. The tool becomes immediately available in this conversation and persists across restarts. The handler_code is an async JavaScript function body with `args` and `fetch` in scope. It must return { success: boolean, data?: any, error?: string }. Use this for thin API wrappers (geocoding, weather, conversions, etc.).',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Tool name in snake_case (e.g. "reverse_geocode")',
          },
          description: {
            type: 'string',
            description: 'What the tool does',
          },
          toolset: {
            type: 'string',
            description: 'Toolset category (e.g. "geo", "utility", "weather"). Can be new or existing.',
          },
          parameters: {
            type: 'object',
            description: 'JSON Schema for the tool arguments (type, properties, required)',
          },
          handler_code: {
            type: 'string',
            description: 'Async JS function body. Has `args` and `fetch` in scope. Must return { success, data?, error? }.',
          },
        },
        required: ['name', 'description', 'toolset', 'parameters', 'handler_code'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_custom_tools',
      description:
        'List all custom tools that have been created. Shows name, description, toolset, and creation date. Use this to check if a tool already exists before proposing a new one.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
```

- [ ] **Step 2: Add the handler functions**

Add these imports at the top of `meta-tools.ts`:

```typescript
import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { register, isRegisteredTool } from './registry-internal';
import { buildHandler } from './custom-tool-loader';
```

Then add handler functions after the existing `handleJkaiHelp` function:

```typescript
export async function handleCreateTool(args: Record<string, unknown>): Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
}> {
  const name = args.name as string;
  const description = args.description as string;
  const toolset = args.toolset as string;
  const parameters = args.parameters as { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  const handlerCode = args.handler_code as string;

  // Validate name doesn't conflict
  if (isRegisteredTool(name)) {
    return { success: false, error: `Tool "${name}" already exists in the registry.` };
  }

  // Build and register the handler
  const handler = buildHandler(name, handlerCode);
  register({
    name,
    description,
    toolset,
    parameters,
    category: 'Custom Tool',
    handler,
  });

  // Persist to DB
  try {
    await db.insert(customTools).values({
      name,
      description,
      toolset,
      parameters,
      handlerCode,
    });
  } catch (err) {
    return { success: false, error: `Tool registered in memory but failed to persist: ${err instanceof Error ? err.message : String(err)}` };
  }

  return {
    success: true,
    data: {
      name,
      toolset,
      description,
      message: `Tool "${name}" created and registered. You can call it now.`,
    },
  };
}

export async function handleListCustomTools(): Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
}> {
  try {
    const rows = await db.select({
      name: customTools.name,
      description: customTools.description,
      toolset: customTools.toolset,
      enabled: customTools.enabled,
      createdAt: customTools.createdAt,
    }).from(customTools);

    return { success: true, data: { tools: rows, count: rows.length } };
  } catch {
    return { success: true, data: { tools: [], count: 0 } };
  }
}
```

- [ ] **Step 3: Update the import in registry-internal.ts**

Add `isRegisteredTool` to the exports in `registry-internal.ts`. Add this function at the end of the file:

```typescript
export function isRegisteredTool(name: string): boolean {
  return tools.some((t) => t.name === name);
}
```

- [ ] **Step 4: Update registry.ts to use registry-internal's isRegisteredTool**

In `src/lib/workflows/site-tools/registry.ts`, the existing `isRegisteredTool` function (line 105-107) should be replaced to re-export from `registry-internal`:

Replace:
```typescript
export function isRegisteredTool(name: string): boolean {
  return tools.some((t) => t.name === name);
}
```

With:
```typescript
export { isRegisteredTool } from './registry-internal';
```

Also add `isRegisteredTool` to the import line from `./registry-internal` (line 6):
```typescript
import { tools, getToolsByToolset, getAvailableToolsets, isRegisteredTool as _isRegisteredTool } from './registry-internal';
```

Actually simpler — just remove the local function and add to the re-export line at the bottom:
```typescript
export { getToolsByToolset, getAvailableToolsets, isRegisteredTool };
```

And import it:
```typescript
import { tools, getToolsByToolset, getAvailableToolsets, isRegisteredTool } from './registry-internal';
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/site-tools/meta-tools.ts src/lib/workflows/site-tools/registry-internal.ts src/lib/workflows/site-tools/registry.ts
git commit -m "feat: add create_tool and list_custom_tools meta-tools"
```

---

### Task 5: Wire `create_tool` and `list_custom_tools` into general chat

**Files:**
- Modify: `src/lib/workflows/chat/general-chat.ts`

- [ ] **Step 1: Add imports**

Add to the imports at the top of `general-chat.ts`:

```typescript
import { handleCreateTool, handleListCustomTools } from '$lib/workflows/site-tools/meta-tools';
import { getToolsetDefinitions } from '$lib/workflows/site-tools/llm-tools';
```

Note: `getToolsetDefinitions` is already imported via the `llm-tools` import on line 9 — no change needed for that one.

- [ ] **Step 2: Add handlers in the tool dispatch block**

In the tool call dispatch section (around line 174, after the `jkai_help` handler), add:

```typescript
      } else if (fnName === 'create_tool') {
        toolResult = await handleCreateTool(fnArgs);
        // Inject the new tool into activeTools so it's callable this conversation
        if (toolResult.success) {
          const newToolName = fnArgs.name as string;
          const newToolset = fnArgs.toolset as string;
          const newDefs = getToolsetDefinitions(newToolset).filter(d => d.function.name === newToolName);
          activeTools.push(...newDefs);
          activatedToolsets.add(newToolset);
        }
      } else if (fnName === 'list_custom_tools') {
        toolResult = await handleListCustomTools();
```

These go between the `jkai_help` handler and the `else` block that handles HA tools.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflows/chat/general-chat.ts
git commit -m "feat: wire create_tool and list_custom_tools into general chat dispatch"
```

---

### Task 6: Update system prompt

**Files:**
- Modify: `data/prompts/06-problem-solving.md`

- [ ] **Step 1: Rewrite the problem-solving prompt**

Replace the contents of `data/prompts/06-problem-solving.md` with:

```markdown
# Problem Solving & Tool Creation

## Solution-First Mindset

When you encounter something you can't do directly, **never** respond with what you can't do. Instead, think about how to solve it and propose a solution.

## Creating New Tools

You can create new tools for yourself using `create_tool`. When you identify a capability gap:

1. **Recognise the gap** — "I need to reverse geocode these coordinates but I don't have a tool for that."
2. **Propose the tool** — Describe to the user what you want to build:
   - Tool name and purpose
   - What API or service it will call
   - What parameters it needs
   - What it will return
3. **Wait for approval** — Don't call `create_tool` until the user confirms.
4. **Create and call it** — After approval, call `create_tool` with the full definition, then immediately call the new tool to answer the original question.

The tool persists across conversations — once created, it's always available. Use `list_custom_tools` to check what already exists before proposing duplicates.

## What Makes a Good Custom Tool

- **Thin API wrappers** — calling a public API and returning structured data
- **Simple computations** — unit conversions, date calculations, formatting
- **Data lookups** — geocoding, weather, currency rates, timezone info

The handler code is an async JavaScript function body with `args` (tool arguments) and `fetch` (HTTP client) available. It must return `{ success: true, data: ... }` or `{ success: false, error: "..." }`.

## Example Flow

User: "Where exactly is my family right now?"
You have GPS coordinates from Home Assistant but no way to convert them to an address.

**Step 1 — Propose:**
"I can see the coordinates from Home Assistant, but I don't have a reverse geocoding tool yet. I'd like to create one:
- **Tool:** `reverse_geocode` in toolset `geo`
- **API:** OpenStreetMap Nominatim (free, no key needed)
- **Input:** `lat`, `lon`
- **Output:** Full address, display name
Want me to create it?"

**Step 2 — After approval, create:**
Call `create_tool` with the definition and handler code.

**Step 3 — Use immediately:**
Call `reverse_geocode` with the coordinates and give the user the address.

Next time anyone asks a location question, the tool is already there.
```

- [ ] **Step 2: Commit**

```bash
git add data/prompts/06-problem-solving.md
git commit -m "feat: update system prompt with create_tool flow and examples"
```

---

### Task 7: Sync prompts and verify

**Files:** None (runtime verification)

- [ ] **Step 1: Build the project to check for type errors**

Run: `cd ~/strange_rambling_svelte && npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 2: Push schema changes**

Run: `cd ~/strange_rambling_svelte && npx drizzle-kit push`
Expected: `custom_tools` table created (or confirmed up to date).

- [ ] **Step 3: Start the dev server and verify startup logs**

Run: `cd ~/strange_rambling_svelte && npm run dev`
Expected: Logs show `[custom-tools] Table not found — skipping` or `[custom-tools] Loaded 0 custom tool(s)` (no tools yet, just confirming the loader runs).

- [ ] **Step 4: Test via JKAI chat**

Open `http://homeserv:5173/jkai` (or production URL) and ask JKAI something that requires a tool it doesn't have, e.g.:
- "What address are these coordinates? 55.0364, -1.4478"

Verify JKAI:
1. Recognises the gap
2. Proposes a reverse geocoding tool
3. After you approve, creates it via `create_tool`
4. Calls the new tool immediately
5. Returns the answer

- [ ] **Step 5: Verify persistence**

Restart the dev server and check that the tool appears in startup logs and is callable without re-creation.

- [ ] **Step 6: Commit any fixes and deploy**

```bash
# Deploy to production
cd ~/strange_rambling_svelte && bash scripts/deploy.sh
```
