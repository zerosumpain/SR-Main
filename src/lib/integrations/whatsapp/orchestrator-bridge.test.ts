import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  turns: [] as Array<{ options: Record<string, unknown> }>,
  confirm: null as null | { tool: string; args: Record<string, unknown>; prompt: string },
  asked: [] as unknown[][],
}));

/** Any drizzle chain, resolving to `rows` when awaited. */
function chain(rows: unknown[]): unknown {
  const p: unknown = new Proxy(() => {}, {
    get: (_t, k) => (k === 'then' ? (res: (v: unknown) => void) => res(rows) : () => p),
  });
  return p;
}

vi.mock('$lib/db', () => ({
  db: { select: () => chain([{ id: 'conv-1' }]), insert: () => chain([{ id: 'msg-1' }]), delete: () => chain([]) },
}));
vi.mock('$lib/jkai/chat/turn', () => ({
  chatTurn: vi.fn(async (_input: unknown, _history: unknown, options: Record<string, unknown>) => {
    h.turns.push({ options });
    return { response: 'hello', memory: null, confirm: h.confirm };
  }),
}));
vi.mock('$lib/server/models/workload-settings', () => ({
  resolveChatTurnModel: async () => ({ provider: 'openrouter', modelId: 'test/model' }),
}));
vi.mock('./inbound-intercept', () => ({ interceptOwnerInbound: async () => ({ handled: false }) }));
vi.mock('./reply-code.server', () => ({
  askForReplyCode: async (...a: unknown[]) => {
    h.asked.push(a);
    return 'Reply 4831 within 5 minutes to confirm:\nTurn it off?\nAnything else cancels it.';
  },
}));
vi.mock('$lib/jkai/media/storage', () => ({ saveBuffer: async () => ({ diskPath: '/x', sizeBytes: 0 }) }));

const { OrchestratorBridge } = await import('./orchestrator-bridge');
const { WHATSAPP_CONFIRM_BY_CODE, WHATSAPP_TOOL_WHITELIST } = await import('./tool-whitelist');

beforeEach(() => { h.turns = []; h.confirm = null; h.asked = []; });

describe('OrchestratorBridge', () => {
  it('runs every WhatsApp turn on the explicit WhatsApp tool list', async () => {
    const sent: string[] = [];
    const bridge = new OrchestratorBridge(async (_to, text) => { sent.push(text); return { success: true } as never; });
    await bridge.handleMessage({ from: '447700900123', text: 'what is on tomorrow?', timestamp: 0, messageId: 'm', isGroup: false });

    expect(h.turns).toHaveLength(1);
    expect(h.turns[0].options.toolWhitelist).toEqual([...WHATSAPP_TOOL_WHITELIST]);
    expect(h.turns[0].options.toolWhitelist).not.toContain('build_create');
    expect(h.turns[0].options.toolWhitelist).not.toContain('ha_call_service');
    // The envelope tells Core which overlay to answer in: plain and short.
    expect(h.turns[0].options.envelope).toEqual({ surface: 'whatsapp' });
    expect(sent).toEqual(['hello']);
    // The confirm-by-code tools travel apart from the whitelist.
    expect(h.turns[0].options.confirmByCode).toEqual([...WHATSAPP_CONFIRM_BY_CODE]);
    expect(h.asked).toHaveLength(0);
  });

  it('asks for a reply code, bound to the sender and the thread, when Core froze a call', async () => {
    h.confirm = { tool: 'ha_call_service', args: { domain: 'light' }, prompt: 'Turn it off?' };
    const sent: string[] = [];
    const bridge = new OrchestratorBridge(async (_to, text) => { sent.push(text); return { success: true } as never; });
    await bridge.handleMessage({ from: '447700900123', text: 'lights off', timestamp: 0, messageId: 'm', isGroup: false });
    expect(h.asked).toEqual([['447700900123', 'conv-1', h.confirm]]);
    expect(sent).toEqual(['hello\n\nReply 4831 within 5 minutes to confirm:\nTurn it off?\nAnything else cancels it.']);
  });
});
