import { describe, it, expect, beforeAll } from 'vitest';
import { dispatchJsonRpc, parseJsonRpcBody } from './jsonrpc';

const SECRET = 'mcp-jsonrpc-test-secret-32-bytes-long-please-thanks';

beforeAll(() => {
  process.env.HERMES_BRIDGE_SECRET = SECRET;
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

  it('lists tools without auth (discovery is public)', async () => {
    const { response } = await dispatchJsonRpc(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { authBearer: "" },
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

  it('executes tools/call when bearer matches HERMES_BRIDGE_SECRET', async () => {
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
    expect(Array.isArray(parsed.data)).toBe(true);
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
