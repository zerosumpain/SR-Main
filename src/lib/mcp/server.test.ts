import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createMcpToolHandler, listMcpTools } from './server';
import { mintBridgeToken, type TokenScope } from './auth';

const SECRET = 'mcp-server-test-secret-32-bytes-long-please-thanks';

// NOTE: The plan template referenced `create_node`, `add_edge`, and `search_nodes` as
// canonical tool names. The actual workflows-domain tools in
// src/lib/workflows/site-tools/tools/workflows.ts are namespaced `workflow_*`
// (e.g. `workflow_add_node`, `workflow_add_edge`, `workflow_list_node_types`).
// These tests assert the real names and the >= 20 floor still holds (22 register calls).

const scope: TokenScope = {
  sessionId: 'sess_mcp',
  kind: 'canvas_chat',
  kindId: 'wf_42',
  expiresAt: Date.now() + 60_000,
};

beforeAll(() => {
  process.env.HERMES_BRIDGE_SECRET = SECRET;
});

describe('mcp/server', () => {
  it('lists workflow-domain tools (>= 20)', async () => {
    const tools = await listMcpTools();
    expect(tools.length).toBeGreaterThanOrEqual(20);
    expect(tools.find((t) => t.name === 'workflow_add_node')).toBeTruthy();
    expect(tools.find((t) => t.name === 'workflow_add_edge')).toBeTruthy();
  });

  it('rejects a tool call without a bridge token', async () => {
    const handler = createMcpToolHandler();
    await expect(
      handler({ name: 'workflow_add_node', arguments: {}, bridgeToken: '' }),
    ).rejects.toThrow(/missing.*token/i);
  });

  it('rejects a tool call with a scope-mismatched bridge token', async () => {
    const handler = createMcpToolHandler();
    const wrongScope = { ...scope, kindId: 'wf_OTHER' };
    const token = mintBridgeToken(wrongScope, SECRET);
    await expect(
      handler({
        name: 'workflow_add_node',
        arguments: { workflow_id: 'wf_42', type: 'manual-trigger' },
        bridgeToken: token,
      }),
    ).rejects.toThrow(/scope/i);
  });

  it('executes a tool when the bridge token scope matches the call target', async () => {
    // workflow_list_node_types is read-only (no DB touched) and is the safest
    // real-world end-to-end exercise of the auth + dispatch path. The MCP server
    // requires `workflow_id` in arguments for scope binding even though the
    // underlying handler ignores it — that's by design (every workflow-domain
    // call is bound to a canvas).
    const handler = createMcpToolHandler();
    const token = mintBridgeToken(scope, SECRET);
    const result = await handler({
      name: 'workflow_list_node_types',
      arguments: { workflow_id: 'wf_42' },
      bridgeToken: token,
    });
    expect(result).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0].type).toBe('text');
  });
});
