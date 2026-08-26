import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { dispatchJsonRpc, parseJsonRpcBody } from './jsonrpc';
import { subscribeToolSteps, _resetToolStepBusForTests, type ToolStepEvent } from '$lib/jkai/tool-step-bus';

const SECRET = 'mcp-jsonrpc-test-secret-32-bytes-long-please-thanks';

// The full-registry assertions below require JKAI_MCP_META_TOOL OFF. The
// ambient environment may set it to '1' (collapsing tools/list to essentials +
// the dispatcher), so pin it off and restore the prior value afterwards.
const originalMetaFlag = process.env.JKAI_MCP_META_TOOL;
delete process.env.JKAI_MCP_META_TOOL;

afterAll(() => {
  if (originalMetaFlag === undefined) delete process.env.JKAI_MCP_META_TOOL;
  else process.env.JKAI_MCP_META_TOOL = originalMetaFlag;
});

beforeAll(() => {
  process.env.SERVICE_BRIDGE_SECRET = SECRET;
});

beforeEach(() => {
  _resetToolStepBusForTests();
});

describe('mcp/jsonrpc', () => {
  it('returns parse error envelope for malformed JSON', () => {
    const out = parseJsonRpcBody('{not json');
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.error.code).toBe(-32700);
      expect(out.error.id).toBeNull();
    }
  });

  it('responds to initialize without auth and echoes a compatible protocolVersion', async () => {
    // This is the exact shape Hermes' MCP client probes with first; previously
    // got rejected with 403 because the route required an Authorization header.
    const { response } = await dispatchJsonRpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'hermes-test', version: '0.0.0' },
        },
      },
      { authBearer: "" },
    );
    expect(response).not.toBeNull();
    expect(response).toHaveProperty('result');
    const ok = response as { result: { protocolVersion: string; capabilities: unknown; serverInfo: { name: string } } };
    expect(ok.result.protocolVersion).toBe('2025-11-25');
    expect(ok.result.capabilities).toMatchObject({ tools: {} });
    expect(ok.result.serverInfo.name).toBe('strange-rambling-svelte');
  });

  it('falls back to a default protocol version for malformed requests', async () => {
    const { response } = await dispatchJsonRpc(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'not-a-date' } },
      { authBearer: "" },
    );
    const ok = response as { result: { protocolVersion: string } };
    expect(ok.result.protocolVersion).toBe('2025-03-26');
  });

  it('accepts notifications/initialized as a pure notification (null response → 202)', async () => {
    const { response } = await dispatchJsonRpc(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { authBearer: "" },
    );
    expect(response).toBeNull();
  });

  it('responds to ping with empty result', async () => {
    const { response } = await dispatchJsonRpc(
      { jsonrpc: '2.0', id: 'ping-1', method: 'ping' },
      { authBearer: "" },
    );
    expect(response).toMatchObject({ jsonrpc: '2.0', id: 'ping-1', result: {} });
  });

  it('rejects tools/list without auth (the catalogue is not public)', async () => {
    // Changed 2026-07-25. This route bypasses the Auth.js gate as
    // service-to-service traffic, so an open tools/list let anyone who could
    // POST to /api/mcp/local enumerate every tool, description and input
    // schema — a map of every capability the assistant has.
    const { response } = await dispatchJsonRpc(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { authBearer: '' },
    );
    expect(response).toMatchObject({ error: { code: -32001 } });
  });

  it('lists tools when the bearer matches', async () => {
    const { response } = await dispatchJsonRpc(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { authBearer: SECRET },
    );
    expect(response).not.toBeNull();
    const ok = response as { result: { tools: Array<{ name: string }> } };
    expect(Array.isArray(ok.result.tools)).toBe(true);
    expect(ok.result.tools.length).toBeGreaterThanOrEqual(20);
    expect(ok.result.tools.find((t) => t.name === 'workflow_add_node')).toBeTruthy();
  });

  it('rejects tools/call without a bearer token (auth-shaped JSON-RPC error)', async () => {
    const { response } = await dispatchJsonRpc(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'workflow_list_node_types', arguments: { workflow_id: 'wf_99' } },
      },
      { authBearer: "" },
    );
    expect(response).not.toBeNull();
    const err = response as { error: { code: number; message: string } };
    expect(err.error.code).toBe(-32001);
    expect(err.error.message).toMatch(/bearer/i);
  });

  it('executes tools/call when bearer matches SERVICE_BRIDGE_SECRET', async () => {
    const { response } = await dispatchJsonRpc(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'workflow_list_node_types', arguments: { workflow_id: 'wf_99' } },
      },
      { authBearer: SECRET },
    );
    expect(response).not.toBeNull();
    const ok = response as { result: { content: Array<{ type: string; text: string }> } };
    expect(Array.isArray(ok.result.content)).toBe(true);
    expect(ok.result.content[0].type).toBe('text');
    const parsed = JSON.parse(ok.result.content[0].text);
    // workflow_list_node_types returns { matched, total, types } rather than a
    // bare array, so a filtered call can say how much of the catalogue it cut.
    expect(Array.isArray(parsed.data.types)).toBe(true);
    expect(parsed.data.total).toBeGreaterThan(0);
  });

  it('publishes started + completed tool-step events to the bus on a successful tools/call', async () => {
    // The Hermes branch of /api/workflows/orchestrator/chat subscribes to
    // this bus to surface tool-step events into the canvas SSE stream.
    // Carry-over #1 from Phase 1 acceptance log.
    const events: ToolStepEvent[] = [];
    const unsub = subscribeToolSteps('wf_test_99', (e) => events.push(e));

    await dispatchJsonRpc(
      {
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: { name: 'workflow_list_node_types', arguments: { workflow_id: 'wf_test_99' } },
      },
      { authBearer: SECRET },
    );

    unsub();

    expect(events.length).toBe(2);
    expect(events[0].phase).toBe('started');
    expect(events[0].tool).toBe('workflow_list_node_types');
    expect(events[0].stepId).toMatch(/^step_/);
    expect(events[1].phase).toBe('completed');
    expect(events[1].stepId).toBe(events[0].stepId);
    expect(events[1].resultPreview).toBeTruthy();
  });

  it('does not publish tool-step events when the call carries no workflow_id', async () => {
    // workflow_id is the bus key; without one we can't route the event to
    // any subscriber, so don't bother publishing.
    const events: ToolStepEvent[] = [];
    const unsub = subscribeToolSteps('wf_should_not_fire', (e) => events.push(e));

    await dispatchJsonRpc(
      {
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: { name: 'workflow_list_node_types', arguments: {} },
      },
      { authBearer: SECRET },
    );

    unsub();
    expect(events.length).toBe(0);
  });

  it('exposes the full tool registry to MCP callers (no SvelteKit-side toolset gate)', async () => {
    // Phase 1.5: skill-system-based constraint, not SvelteKit-side gating.
    // Hermes' active skill restricts which tools the agent considers; the
    // MCP server is permissive.
    const { response } = await dispatchJsonRpc(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'blog_list', arguments: {} },
      },
      { authBearer: SECRET },
    );
    // Either success or a tool-layer error — what we don't want is the old
    // -32602 "not exposed in this profile" rejection.
    if ('error' in (response as unknown as Record<string, unknown>)) {
      const err = response as { error: { code: number; message: string } };
      expect(err.error.message).not.toMatch(/not exposed/i);
    }
  });

  it('tools/list returns the full registry (not just workflows)', async () => {
    // Phase 1.5: tools/list must reflect the full registry. Hermes skills do
    // the filtering; the MCP server is permissive. Catches regressions of the
    // server.ts listMcpTools() widening (getTools() vs getToolsByToolset('workflows')).
    const { response } = await dispatchJsonRpc(
      { jsonrpc: '2.0', id: 8, method: 'tools/list' },
      { authBearer: SECRET }, // tools/list is authenticated as of 2026-07-25
    );
    const ok = response as { result: { tools: Array<{ name: string }> } };
    expect(ok.result.tools.length).toBeGreaterThan(50); // 130ish; use a loose floor
    expect(ok.result.tools.find((t) => t.name === 'blog_list')).toBeTruthy();
    expect(ok.result.tools.find((t) => t.name === 'workflow_add_node')).toBeTruthy();
  });

  it('returns method-not-found error for unknown request methods', async () => {
    const { response } = await dispatchJsonRpc(
      { jsonrpc: '2.0', id: 5, method: 'totally/made/up' },
      { authBearer: "" },
    );
    const err = response as { error: { code: number } };
    expect(err.error.code).toBe(-32601);
  });

  it('silently accepts unknown notifications (no response, no error)', async () => {
    const { response } = await dispatchJsonRpc(
      { jsonrpc: '2.0', method: 'notifications/some/future/thing' },
      { authBearer: "" },
    );
    expect(response).toBeNull();
  });

  it('returns INVALID_REQUEST for non-JSON-RPC objects', async () => {
    const { response } = await dispatchJsonRpc({ hello: 'world' }, { authBearer: "" });
    const err = response as { error: { code: number }; id: null };
    expect(err.error.code).toBe(-32600);
    expect(err.id).toBeNull();
  });
});
