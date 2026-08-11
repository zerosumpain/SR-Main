import { describe, expect, it, vi, beforeEach } from 'vitest';

const nodes = vi.hoisted(() => ({
  definitions: new Map<string, unknown>(),
  executors: new Map<string, { execute: ReturnType<typeof vi.fn> }>(),
}));

vi.mock('$lib/workflows', () => ({
  registry: {
    getDefinition: (t: string) => nodes.definitions.get(t),
    getExecutor: (t: string) => nodes.executors.get(t),
  },
}));

import { ALLOWED, handleNodeCall } from './node-call';

const exec = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  nodes.definitions = new Map<string, unknown>([['apple-calendar', {}], ['whatsapp', {}]]);
  nodes.executors = new Map([['apple-calendar', { execute: exec }]]);
});

describe('node_call', () => {
  it('runs an allowed node and returns its output', async () => {
    exec.mockResolvedValue({ output: { events: [{ title: 'Lunch' }] }, rowCount: 1 });
    const r = await handleNodeCall({ type: 'apple-calendar', config: { operation: 'list', calendar: '/family/' } });
    expect(r).toMatchObject({ success: true, data: { output: { events: [{ title: 'Lunch' }] }, rowCount: 1 } });
  });

  it('hands the executor a usable context rather than an empty object', async () => {
    // The old shape at these call sites was `{} as any`, which works only for
    // as long as no executor reads its context. Three of the allowed nodes
    // already read abortSignal, runId or emit.
    exec.mockResolvedValue({ output: {}, rowCount: 0 });
    await handleNodeCall({ type: 'apple-calendar', config: { operation: 'list' } });
    const context = exec.mock.calls[0][2];
    expect(context.abortSignal).toBeInstanceOf(AbortSignal);
    expect(typeof context.runId).toBe('string');
    expect(typeof context.emit).toBe('function');
    expect(context.getOutgoingEdges('x')).toEqual([]);
  });

  it('surfaces events the node emitted', async () => {
    exec.mockImplementation(async (_i: unknown, _c: unknown, ctx: { emit: (e: unknown) => void }) => {
      ctx.emit({ type: 'log', data: { step: 1 } });
      return { output: {}, rowCount: 0 };
    });
    const r = await handleNodeCall({ type: 'apple-calendar', config: { operation: 'list' } });
    expect((r.data as { events: unknown[] }).events).toHaveLength(1);
  });

  // The safety surface. Each of these is a way the fast lane could quietly
  // become a write path or an arbitrary-code path.
  it('refuses a node that is registered but not on the allowlist', async () => {
    const r = await handleNodeCall({ type: 'whatsapp', config: {} });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not runnable outside a workflow/);
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails closed on an unknown type instead of trying to run it', async () => {
    const r = await handleNodeCall({ type: 'definitely-not-a-node', config: {} });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/No node type/);
  });

  it('refuses the write half of a node whose executor branches on operation', async () => {
    // apple-calendar's single executor also creates, updates and deletes.
    // Allowing the type without reading the config would put an unconfirmed
    // CalDAV write behind a tool documented as read-only.
    for (const operation of ['create', 'update', 'delete', undefined]) {
      const r = await handleNodeCall({ type: 'apple-calendar', config: { operation } });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/read-only/);
    }
    expect(exec).not.toHaveBeenCalled();
  });

  it('every allowed entry says why, and every guarded one refuses by default', () => {
    // A new entry added without a reason is one nobody has thought about.
    for (const [type, entry] of Object.entries(ALLOWED)) {
      expect(entry.why, `${type} has no reason`).toBeTruthy();
      if (entry.guard) expect(entry.guard({}), `${type} guard allows an empty config`).toBeTruthy();
    }
  });

  it('passes a node error through instead of flattening it', async () => {
    // "Unknown calendar: /x/" is the message that tells the user what to fix.
    exec.mockRejectedValue(new Error('Unknown calendar: /x/'));
    const r = await handleNodeCall({ type: 'apple-calendar', config: { operation: 'list' } });
    expect(r).toMatchObject({ success: false, error: 'apple-calendar: Unknown calendar: /x/' });
  });

  it('requires a type and names what it will accept', async () => {
    const r = await handleNodeCall({ config: {} });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/apple-calendar/);
  });
});
