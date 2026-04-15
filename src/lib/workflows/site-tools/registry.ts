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

  const manifest = getAvailableToolsets().map((ts) => ({
    toolset: ts,
    description: toolsetDescriptions[ts] || ts,
    tools: getToolsByToolset(ts).map((t) => ({
      name: t.name,
      description: t.description,
    })),
  }));

  // HA tools live outside the domain module system — add a synthetic entry
  if (!manifest.some((m) => m.toolset === 'home')) {
    manifest.push({
      toolset: 'home',
      description: toolsetDescriptions.home,
      tools: [
        { name: 'ha_query_state', description: 'Get the current state and attributes of a Home Assistant entity' },
        { name: 'ha_call_service', description: 'Call a Home Assistant service to control a device' },
        { name: 'ha_fire_event', description: 'Fire a Home Assistant event to trigger automations' },
        { name: 'ha_get_history', description: 'Get historical state data for an entity over a time period' },
        { name: 'ha_render_template', description: 'Evaluate a Home Assistant Jinja2 template server-side' },
      ],
    });
  }

  return manifest;
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
