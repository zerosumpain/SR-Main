import { describe, it, expect } from 'vitest';
import { listMcpTools } from './server';

// NOTE: The plan template referenced `create_node`, `add_edge`, and `search_nodes` as
// canonical tool names. The actual workflows-domain tools in
// src/lib/workflows/site-tools/tools/workflows.ts are namespaced `workflow_*`
// (e.g. `workflow_add_node`, `workflow_add_edge`, `workflow_list_node_types`).
// These tests assert the real names and the >= 20 floor still holds (22 register calls).

describe('mcp/server', () => {
  it('lists workflow-domain tools (>= 20)', async () => {
    const tools = await listMcpTools();
    expect(tools.length).toBeGreaterThanOrEqual(20);
    expect(tools.find((t) => t.name === 'workflow_add_node')).toBeTruthy();
    expect(tools.find((t) => t.name === 'workflow_add_edge')).toBeTruthy();
  });
});
