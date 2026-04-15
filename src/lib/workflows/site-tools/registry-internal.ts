// Internal registry state — separated to avoid circular initialization with domain modules.
// Domain modules import `register` from here. The public API in registry.ts re-exports everything.

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

export const tools: ToolDefinition[] = [];

export function register(tool: ToolDefinition) {
  tools.push(tool);
}
