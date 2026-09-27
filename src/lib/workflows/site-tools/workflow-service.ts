import { env } from '$env/dynamic/private';
import { register, type ToolDefinition, type ToolExecContext, type ToolResult } from './registry-internal';
import { invokeRemoteTool, type RemoteInvokeTarget } from './remote';

export function workflowTarget(destructive = false): RemoteInvokeTarget | null {
  const url = env.WORKFLOWS_TOOL_INVOKE_URL;
  const token = destructive ? env.WORKFLOWS_DESTRUCTIVE_TOOL_INVOKE_TOKEN : env.WORKFLOWS_TOOL_INVOKE_TOKEN;
  if (!url || !token || token.length < 32) return null;
  return { url, token, host: env.WORKFLOWS_TOOL_INVOKE_HOST || undefined };
}

/** Fail closed: a service outage never reactivates Main's former implementation. */
export async function invokeWorkflowTool(name: string, args: Record<string, unknown>, destructive = false, ctx?: ToolExecContext): Promise<ToolResult> {
  const target = workflowTarget(destructive);
  if (!target) return { success: false, error: `Workflows ${destructive ? 'destructive ' : ''}tool service is not configured` };
  try { return await invokeRemoteTool(name, args, ctx, target); }
  catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Workflows service unavailable' }; }
}

export function registerWorkflowTool(tool: Omit<ToolDefinition, 'handler'>): void {
  register({ ...tool, handler: (args, ctx) => invokeWorkflowTool(tool.name, args, !!tool.destructive, ctx) });
}
