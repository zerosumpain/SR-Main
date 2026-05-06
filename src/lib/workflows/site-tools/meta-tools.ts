// src/lib/workflows/site-tools/meta-tools.ts

import { getToolsetManifest, getAvailableToolsets } from './registry';
import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { register, unregister, isRegisteredTool } from './registry-internal';
import { buildHandler } from './custom-tool-loader';

// Built at module load. Safe because every importer of META_TOOL_DEFINITIONS
// pulls `./registry` first, so all register() calls have completed.
const LIVE_TOOLSET_LIST = getAvailableToolsets().slice().sort().join(', ');

export const META_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'activate_toolset',
      description:
        `Load a category of tools into the current conversation. Call this before using domain-specific tools. You can activate multiple toolsets by calling this multiple times in the same turn. Built-in toolsets: ${LIVE_TOOLSET_LIST}. Custom toolsets (from create_tool) are also supported — use list_custom_tools to discover them.`,
      parameters: {
        type: 'object',
        properties: {
          toolset: {
            type: 'string',
            description: 'The toolset to activate (e.g. "home", "geo", "health")',
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
        'See what capabilities and tools are available. Returns all toolsets with their tool names and descriptions, including custom tools. Use this when unsure which toolset to activate.',
      parameters: {
        type: 'object',
        properties: {
          toolset: {
            type: 'string',
            description: 'Optional: filter to a specific toolset for detailed info',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_tool',
      description:
        'Create and register a new tool at runtime. The tool becomes immediately available in this conversation and persists across restarts. The handler_code is an async JavaScript function body with `args`, `fetch`, AND `platform` in scope. It must return { success: boolean, data?: any, error?: string }. Two common patterns: (1) thin API wrappers via `fetch` — for public APIs that need no auth (geocoding, weather, conversions); (2) composed tools via `platform.call(toolName, args)` — for anything that needs authentication (Home Assistant, Whoop, Strava, etc.). platform.call reuses the platform\'s existing auth, so you never need URLs, tokens, or env vars in your handler. Example composed tool: `const hist = await platform.call("ha_get_history", { entity_id: "device_tracker.katie" }); if (!hist.success) return hist; return { success: true, data: hist.data.filter(s => s.state !== "home") };`',
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
        'List all custom tools that have been created. Shows name, description, toolset, creation date, run count, error count, and last-run time. Use this to check if a tool already exists before proposing a new one.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_tool',
      description:
        'Permanently delete a custom tool by name. Only works on tools that exist in the custom_tools table — built-in tools cannot be deleted. Removes the row from the DB AND unregisters the tool from the in-memory registry so it disappears from this conversation immediately. Use when cleaning up broken/superseded/debug tools. Confirm with the user before deleting anything non-trivial.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Exact tool name to delete, e.g. "family_trips_v1"',
          },
        },
        required: ['name'],
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
      runCount: customTools.runCount,
      errorCount: customTools.errorCount,
      lastRunAt: customTools.lastRunAt,
      createdAt: customTools.createdAt,
    }).from(customTools);

    return { success: true, data: { tools: rows, count: rows.length } };
  } catch {
    return { success: true, data: { tools: [], count: 0 } };
  }
}

export async function handleDeleteTool(args: Record<string, unknown>): Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
}> {
  const name = args.name as string;
  if (!name || typeof name !== 'string') {
    return { success: false, error: 'name is required' };
  }

  // Only allow deletion of tools that exist in the custom_tools table.
  // Built-in tools (from code) do not have a row here and cannot be deleted.
  let row;
  try {
    [row] = await db.select().from(customTools).where(eq(customTools.name, name)).limit(1);
  } catch (err) {
    return { success: false, error: `DB lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!row) {
    return {
      success: false,
      error: `No custom tool named "${name}" exists. Built-in tools cannot be deleted — only tools created via create_tool can be removed.`,
    };
  }

  try {
    await db.delete(customTools).where(eq(customTools.name, name));
  } catch (err) {
    return { success: false, error: `DB delete failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Also pull it out of the in-memory registry so this conversation can't
  // still call it after deletion.
  const wasLive = unregister(name);

  return {
    success: true,
    data: {
      name,
      toolset: row.toolset,
      removedFromRegistry: wasLive,
      message: `Custom tool "${name}" deleted. ${wasLive ? 'Removed from active registry — calls to it will now fail.' : 'Was not in active registry (already restarted or never loaded).'}`,
    },
  };
}
