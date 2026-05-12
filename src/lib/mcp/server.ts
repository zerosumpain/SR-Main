// Exposes the full site-tools registry to Hermes over MCP. See
// jsonrpc.ts for the JSON-RPC dispatcher and auth model.
// Toolset-level filtering is handled by Hermes skills, not here.

import {
  getTools,
} from '$lib/workflows/site-tools/registry';
import type { ToolDefinition } from '$lib/workflows/site-tools/registry-internal';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallRequest {
  name: string;
  arguments: Record<string, unknown>;
  bridgeToken: string;
}

export interface McpCallResult {
  content: Array<{ type: 'text'; text: string }>;
}

function toolToMcp(def: ToolDefinition): McpTool {
  return {
    name: def.name,
    description: def.description ?? '',
    inputSchema: (def.parameters as unknown as Record<string, unknown>) ?? {
      type: 'object',
      properties: {},
    },
  };
}

export async function listMcpTools(): Promise<McpTool[]> {
  const tools = getTools();
  return tools.map(toolToMcp);
}

/**
 * Accept either `workflow_id` (plan-spec name) or `workflowId` (actual tool
 * schema name). The MCP server uses it for scope binding only; arguments pass
 * through to the handler untouched.
 */
export function resolveWorkflowId(args: Record<string, unknown>): string {
  return String(args.workflow_id ?? args.workflowId ?? '');
}
