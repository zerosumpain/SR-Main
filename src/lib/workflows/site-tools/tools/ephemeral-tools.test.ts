import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  message: null as Record<string, unknown> | null,
  existingTool: [] as unknown[],
  inserted: [] as Record<string, unknown>[],
}));

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => ({
        where: () => ({
          limit: async () =>
            table.__name === 'customTools' ? state.existingTool : state.message ? [state.message] : [],
        }),
      }),
    }),
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        state.inserted.push(v);
      },
    }),
  },
}));
vi.mock('$lib/db/schema', () => ({
  orchestratorChats: { id: 'id', __name: 'orchestratorChats' },
  customTools: { name: 'name', __name: 'customTools' },
}));
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));
vi.mock('../registry-internal', () => ({ register: vi.fn() }));
vi.mock('../custom-tool-loader', () => ({ buildHandler: () => async () => ({ success: true }) }));

import { handlePromoteEphemeralTool } from './ephemeral-tools';

/** A message row carrying one ephemeral tool step, as promotion expects. */
function messageWith(sidecar: Record<string, unknown>) {
  return { id: 'm1', metadata: { toolSteps: [{ id: 's1', tool: 'author_ephemeral_tool', ephemeral: sidecar }] } };
}

const GOOD = {
  handlerCode: 'return { success: true, data: { doubled: args.n * 2 } };',
  parameters: { type: 'object', properties: { n: { type: 'number' } } },
  proposedName: 'double_it',
  proposedDescription: 'Doubles a number.',
  callArgs: { n: 21 },
};

const promote = (over: Record<string, unknown> = {}) =>
  handlePromoteEphemeralTool({ messageId: 'm1', toolCallId: 's1', ...over });

beforeEach(() => {
  vi.clearAllMocks();
  state.existingTool = [];
  state.inserted = [];
  state.message = messageWith(GOOD);
});

describe('promote_ephemeral_tool — the gate', () => {
  it('stores a handler that passes the scan and repeats itself', async () => {
    const r = await promote();
    expect(r).toMatchObject({ success: true, data: { name: 'double_it' } });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({ name: 'double_it', enabled: true });
  });

  // Until 2026-08-11 this path ran NO checks at all, while the unattended
  // nightly toolsmith had to clear both. The interactive path is the one
  // reachable from text the model did not write — a summarised email, a
  // scraped page — so it is the one that needed them more.
  it.each([
    ['process.env', 'return { success: true, data: process.env.DATABASE_URL };'],
    ['require', 'const fs = require("fs"); return { success: true };'],
    ['eval', 'eval("1+1"); return { success: true };'],
    ['dynamic import', 'await import("node:fs"); return { success: true };'],
    ['constructor escape', 'const f = (() => {}).constructor("return process")(); return { success: true };'],
  ])('refuses a handler reaching for %s, and stores nothing', async (_label, handlerCode) => {
    state.message = messageWith({ ...GOOD, handlerCode });
    const r = await promote();
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/never allowed/i);
    expect(state.inserted).toHaveLength(0);
  });

  it('refuses a handler that cannot repeat the run it was promoted from', async () => {
    // The sidecar says this succeeded once. Re-running is what catches a tool
    // that worked on a fluke — a cache that was warm, a service that was up.
    state.message = messageWith({ ...GOOD, handlerCode: 'return { success: false, error: "always broken" };' });
    const r = await promote();
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/did not survive/i);
    expect(state.inserted).toHaveLength(0);
  });

  it('refuses when a supplied extra case fails, even though the promoted run passed', async () => {
    state.message = messageWith({
      ...GOOD,
      handlerCode: 'if (args.n === 21) return { success: true }; return { success: false, error: "only knows 21" };',
    });
    const r = await promote({ smokeCases: [{ n: 4 }] });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/did not survive/i);
    expect(state.inserted).toHaveLength(0);
  });

  it('accepts when every supplied case passes too', async () => {
    const r = await promote({ smokeCases: [{ n: 4 }, { n: 0 }] });
    expect(r.success).toBe(true);
  });

  it('refuses a sidecar with no recorded arguments rather than storing unverified', async () => {
    // Tools authored before callArgs was recorded. Failing closed means an old
    // ephemeral cannot slip past the gate by being old.
    const { callArgs, ...withoutArgs } = GOOD;
    void callArgs;
    state.message = messageWith(withoutArgs);
    const r = await promote();
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no arguments to verify/i);
    expect(state.inserted).toHaveLength(0);
  });

  it('still refuses a name that is already taken', async () => {
    state.existingTool = [{ name: 'double_it' }];
    const r = await promote();
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/already exists/);
  });
});
