// Tool Registry — Slim Coordinator
// Types and register() live in registry-internal.ts to avoid circular init with domain modules.

export { register } from './registry-internal';
export type { ToolDefinition, ToolResult } from './registry-internal';
import { tools } from './registry-internal';
import type { ToolResult } from './registry-internal';

// --- Load all domain modules (each calls register() on import) ---
import './tools/health';
import './tools/blog';
import './tools/builds';
import './tools/research';
import './tools/whatsapp';
import './tools/workflows';

// --- Public API ---

export function getTools() {
  return tools as readonly (typeof tools)[number][];
}

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

export function buildSystemPromptSection(): string {
  const categories = new Map<string, string[]>();
  for (const t of tools) {
    if (!categories.has(t.category)) categories.set(t.category, []);
    categories.get(t.category)!.push(t.name);
  }

  const lines = [
    '\n\n--- Site Capabilities ---',
    "You have access to the following tools on the user's personal platform (strangeramblings.com):\n",
  ];
  for (const [category, names] of categories) {
    lines.push(`**${category}** (${names.join(', ')})`);
  }

  lines.push('');
  lines.push("John's WhatsApp number: +447359228511");

  return lines.join('\n');
}
