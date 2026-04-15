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
