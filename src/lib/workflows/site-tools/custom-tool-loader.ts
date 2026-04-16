// src/lib/workflows/site-tools/custom-tool-loader.ts

import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { register } from './registry-internal';
import type { ToolResult } from './registry-internal';

// Module-level guard against custom-tool recursion. Depth reflects how deeply
// nested custom-tool → platform.call → custom-tool chains can go before we
// refuse further calls. Prevents runaway loops if the LLM writes a tool that
// calls itself.
const MAX_PLATFORM_CALL_DEPTH = 5;
let currentDepth = 0;

/**
 * Platform object injected into every custom tool's handler. Lets the tool
 * compose existing registered tools (built-in OR other custom tools) without
 * having to re-implement credentials or API clients.
 *
 * Example:
 *   const state = await platform.call('ha_query_state', { entity_id: 'light.x' });
 *   if (!state.success) return { success: false, error: state.error };
 */
export interface ToolPlatform {
  /** Invoke any registered tool by name. Returns { success, data?, error? }. */
  call: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
}

function buildPlatform(callerName: string): ToolPlatform {
  return {
    async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
      if (currentDepth >= MAX_PLATFORM_CALL_DEPTH) {
        return {
          success: false,
          error: `platform.call depth limit (${MAX_PLATFORM_CALL_DEPTH}) exceeded while calling "${name}" from "${callerName}". Check for tools calling each other in a loop.`,
        };
      }
      // Lazy import to avoid circular init between registry.ts and this module.
      const { executeTool } = await import('./registry');
      currentDepth++;
      try {
        return await executeTool(name, args);
      } finally {
        currentDepth--;
      }
    },
  };
}

/**
 * Wraps handler_code string into a callable async function.
 * The handler receives:
 *   - args: the tool arguments passed by the LLM
 *   - fetch: global fetch for HTTP calls
 *   - platform: { call(toolName, args) } to invoke other registered tools
 *       (this is how custom tools reach authenticated services like HA,
 *        Whoop, Strava, etc. — without managing credentials themselves)
 * Must return { success: boolean, data?: unknown, error?: string }.
 */
function buildHandler(name: string, code: string): (args: Record<string, unknown>) => Promise<ToolResult> {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('args', 'fetch', 'platform', code) as (
    args: Record<string, unknown>,
    fetch: typeof globalThis.fetch,
    platform: ToolPlatform,
  ) => Promise<ToolResult>;

  const platform = buildPlatform(name);

  return async (args: Record<string, unknown>) => {
    let result: ToolResult;
    try {
      result = await fn(args, globalThis.fetch, platform);
    } catch (err) {
      result = { success: false, error: `Custom tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    // Fire-and-forget run tracking — don't let DB issues break the tool call
    const isError = !result.success;
    db.update(customTools)
      .set({
        runCount: sql`${customTools.runCount} + 1`,
        errorCount: isError ? sql`${customTools.errorCount} + 1` : customTools.errorCount,
        lastRunAt: new Date(),
      })
      .where(eq(customTools.name, name))
      .catch((err: unknown) => {
        console.warn(`[custom-tools] Run-count update failed for "${name}":`, err instanceof Error ? err.message : err);
      });

    return result;
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
