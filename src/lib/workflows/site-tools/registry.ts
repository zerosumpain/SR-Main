// src/lib/workflows/site-tools/registry.ts

// ==========================================
// Tool Registry — Slim Coordinator
// ==========================================

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
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

const tools: ToolDefinition[] = [];

export function register(tool: ToolDefinition) {
  tools.push(tool);
}

// --- Load all domain modules (each calls register() on import) ---
import './tools/health';
import './tools/blog';
import './tools/builds';
import './tools/research';
import './tools/whatsapp';
import './tools/workflows';

// --- Public API ---

export function getTools(): readonly ToolDefinition[] {
  return tools;
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
