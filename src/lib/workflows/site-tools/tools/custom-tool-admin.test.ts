import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  deletes: [] as unknown[],
  registered: [] as Record<string, unknown>[],
  unregistered: [] as string[],
  handlerResult: async (args: Record<string, unknown>) =>
    ({ success: (args.n as number) > 0, error: 'non-positive' }) as { success: boolean; error?: string },
}));

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => {
        const rows = state.rows;
        return Object.assign(Promise.resolve(rows), {
          where: () => ({ limit: async () => rows.slice(0, 1) }),
        });
      },
    }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => state.updates.push(v) }) }),
    delete: () => ({ where: async () => state.deletes.push(true) }),
  },
}));
vi.mock('$lib/db/schema', () => ({ customTools: { name: 'name' } }));
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));
vi.mock('../registry-internal', () => ({
  register: (t: Record<string, unknown>) => state.registered.push(t),
  unregister: (n: string) => {
    state.unregistered.push(n);
    return true;
  },
}));
vi.mock('../custom-tool-loader', () => ({
  buildHandler: () => (args: Record<string, unknown>) => state.handlerResult(args),
}));

import './custom-tool-admin';

// Pull the registered handlers back out — registration is the public surface.
const tool = (name: string) => {
  const t = state.registered.find((r) => r.name === name);
  if (!t) throw new Error(`${name} was never registered`);
  return t.handler as (a: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }>;
};

const ROW = {
  name: 'weather_now',
  description: 'Current weather.',
  toolset: 'weather',
  enabled: true,
  runCount: 10,
  errorCount: 8,
  handlerCode: 'return { success: true };',
  parameters: { type: 'object', properties: {} },
};

beforeEach(() => {
  state.rows = [{ ...ROW }];
  state.updates = [];
  state.deletes = [];
  state.unregistered = [];
  state.handlerResult = async (args) => ({ success: (args.n as number) > 0, error: 'non-positive' });
});

describe('list_custom_tools', () => {
  // These three were only ever wired into general-chat.ts, which went dormant
  // at the Hermes cutover — so from that day chat could not see, repair or
  // remove any of the tools the platform had written for itself.
  it('names the tools that are failing rather than leaving arithmetic to the reader', async () => {
    state.rows = [
      { ...ROW, name: 'healthy', runCount: 20, errorCount: 0 },
      { ...ROW, name: 'broken', runCount: 10, errorCount: 8 },
      { ...ROW, name: 'too_new', runCount: 1, errorCount: 1 },
    ];
    const r = await tool('list_custom_tools')({});
    const data = r.data as { count: number; failing?: string[] };
    expect(data.count).toBe(3);
    expect(data.failing).toEqual(['broken (8/10 failed)']);
  });

  it('says nothing about failures when there are none', async () => {
    state.rows = [{ ...ROW, runCount: 20, errorCount: 0 }];
    expect((await tool('list_custom_tools')({})).data).not.toHaveProperty('failing');
  });
});

describe('update_tool', () => {
  it('replaces a handler that passes the scan and every supplied case', async () => {
    state.handlerResult = async () => ({ success: true });
    const r = await tool('update_tool')({
      name: 'weather_now',
      handlerCode: 'return { success: true, data: {} };',
      smokeCases: [{ n: 1 }, { n: 2 }],
    });
    expect(r).toMatchObject({ success: true, data: { casesPassed: 2 } });
    expect(state.updates[0]).toMatchObject({ runCount: 0, errorCount: 0 });
  });

  it('resets the counters, because they described a handler that no longer exists', async () => {
    state.handlerResult = async () => ({ success: true });
    await tool('update_tool')({ name: 'weather_now', handlerCode: 'return { success: true };', smokeCases: [{ n: 1 }] });
    expect(state.updates[0]).toMatchObject({ runCount: 0, errorCount: 0 });
  });

  it('leaves the old handler running when the new one fails a case', async () => {
    const r = await tool('update_tool')({
      name: 'weather_now',
      handlerCode: 'return { success: true };',
      smokeCases: [{ n: -1 }],
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/still live and unchanged/);
    expect(state.updates).toHaveLength(0);
  });

  it('refuses a handler reaching outside the sandbox', async () => {
    const r = await tool('update_tool')({
      name: 'weather_now',
      handlerCode: 'return { success: true, data: process.env };',
      smokeCases: [{ n: 1 }],
    });
    expect(r.success).toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it('demands evidence before swapping code', async () => {
    const r = await tool('update_tool')({ name: 'weather_now', handlerCode: 'return { success: true };' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/needs smokeCases/);
    expect(state.updates).toHaveLength(0);
  });

  it('lets a description-only edit through without ceremony', async () => {
    const r = await tool('update_tool')({ name: 'weather_now', description: 'Now with feels-like.' });
    expect(r).toMatchObject({ success: true, data: { changed: ['description'] } });
    expect(state.updates[0]).toEqual({ description: 'Now with feels-like.' });
  });

  it('points at request_change when the tool is not a stored one', async () => {
    state.rows = [];
    const r = await tool('update_tool')({ name: 'gmail_send', handlerCode: 'x', smokeCases: [{}] });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/request_change/);
  });
});

describe('delete_tool', () => {
  it('removes the row and pulls it out of the live registry', async () => {
    const r = await tool('delete_tool')({ name: 'weather_now' });
    expect(r).toMatchObject({ success: true, data: { removedFromRegistry: true } });
    expect(state.deletes).toHaveLength(1);
    expect(state.unregistered).toEqual(['weather_now']);
  });

  it('refuses to pretend it deleted a built-in', async () => {
    state.rows = [];
    const r = await tool('delete_tool')({ name: 'gmail_send' });
    expect(r.success).toBe(false);
    expect(state.deletes).toHaveLength(0);
  });
});
