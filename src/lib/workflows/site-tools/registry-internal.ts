// Internal registry state — separated to avoid circular initialization with domain modules.
// Domain modules import `register` from here. The public API in registry.ts re-exports everything.

export type ToolResult = { success: boolean; data?: unknown; error?: string };

export interface ToolContext {
  conversationId?: string | null;
  messageId?: string | null;
  parentJobId?: string | null;
}

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
  handler: (args: Record<string, unknown>, ctx?: ToolContext) => Promise<ToolResult>;
}

export const tools: ToolDefinition[] = [];

export function register(tool: ToolDefinition) {
  tools.push(tool);
}

/**
 * Remove a tool from the in-memory registry by name. Returns true if a tool
 * was removed. Used when deleting custom tools so they disappear from the
 * active session without needing a process restart.
 */
export function unregister(name: string): boolean {
  const idx = tools.findIndex((t) => t.name === name);
  if (idx < 0) return false;
  tools.splice(idx, 1);
  return true;
}

export function getToolsByToolset(toolset: string): ToolDefinition[] {
  return tools.filter((t) => t.toolset === toolset);
}

export function getAvailableToolsets(): string[] {
  return [...new Set(tools.map((t) => t.toolset))];
}

export function isRegisteredTool(name: string): boolean {
  return tools.some((t) => t.name === name);
}
