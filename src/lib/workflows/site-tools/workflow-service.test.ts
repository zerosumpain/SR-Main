import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ env: {} as Record<string, string>, invoke: vi.fn(), register: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('./remote', () => ({ invokeRemoteTool: h.invoke }));
vi.mock('./registry-internal', () => ({ register: h.register }));
import { invokeWorkflowTool, registerWorkflowTool } from './workflow-service';
beforeEach(() => { for (const key of Object.keys(h.env)) delete h.env[key]; vi.clearAllMocks(); });
describe('Workflows service handoff', () => {
  it('fails closed without configuration and never invokes a local handler', async () => {
    expect((await invokeWorkflowTool('workflow_run', {})).success).toBe(false);
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it('uses separate destructive credentials and preserves the caller scope and status callback', async () => {
    Object.assign(h.env, { WORKFLOWS_TOOL_INVOKE_URL: 'http://localhost:5390/api/workflows/tools/invoke', WORKFLOWS_TOOL_INVOKE_TOKEN: 's'.repeat(40), WORKFLOWS_TOOL_INVOKE_HOST: 'strangeramblings.com' });
    expect((await invokeWorkflowTool('workflow_delete', {}, true)).success).toBe(false);
    h.env.WORKFLOWS_DESTRUCTIVE_TOOL_INVOKE_TOKEN = 'd'.repeat(40);
    h.invoke.mockResolvedValue({ success: true });
    const ctx = { principalId: 'member-1', allowedTools: ['workflow_delete'], emit: vi.fn() };
    registerWorkflowTool({ name: 'workflow_delete', description: 'Delete', parameters: { type: 'object', properties: {} }, category: 'Workflows', toolset: 'workflows', destructive: true });
    await h.register.mock.calls[0][0].handler({ workflowId: 'w1' }, ctx);
    expect(h.invoke).toHaveBeenCalledWith('workflow_delete', { workflowId: 'w1' }, ctx, expect.objectContaining({ token: 'd'.repeat(40), host: 'strangeramblings.com' }));
  });
  it('does not retry or fall back after a transport error', async () => {
    Object.assign(h.env, { WORKFLOWS_TOOL_INVOKE_URL: 'http://localhost/invoke', WORKFLOWS_TOOL_INVOKE_TOKEN: 's'.repeat(40) });
    h.invoke.mockRejectedValue(new Error('unavailable'));
    expect(await invokeWorkflowTool('workflow_run', {})).toEqual({ success: false, error: 'unavailable' });
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
});
