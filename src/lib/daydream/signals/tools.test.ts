import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  tools: [] as Array<{ name: string; description: string | null; parameters: unknown; enabled: boolean }>,
  ignoredKeys: [] as string[],
}));

vi.mock('$lib/workflows/site-tools/registry', () => ({ executeTool: vi.fn() }));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => h.tools.map((t) => ({ ...t })),
      }),
    }),
  },
}));
vi.mock('$lib/db/schema', () => ({
  customTools: { enabled: 'enabled' },
  daydreamSignals: { key: 'key', source: 'source', status: 'status', observedDays: 'observedDays', firstSeenAt: 'firstSeenAt' },
}));
vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a,
  eq: (a: unknown, b: unknown) => [a, b],
  sql: Object.assign((..._a: unknown[]) => 'sql', { raw: () => 'sql' }),
}));
vi.mock('./registry', () => ({
  registerSignals: vi.fn(async (specs: unknown[]) => ({ registered: specs.length })),
  signalKey: (source: string, id: string) => `${source}:${id}`,
}));

import { executeTool } from '$lib/workflows/site-tools/registry';
import { numericFields, harvestToolSignals, sampleableTools, MAX_TOOLS_PER_RUN } from './tools';

const ok = (data: unknown) => ({ success: true, data });

function tool(name: string, required: string[] = []) {
  return { name, description: `${name} description`, parameters: { required }, enabled: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.tools = [];
  h.ignoredKeys = [];
});

describe('numericFields', () => {
  it('takes plain numbers', () => {
    expect(numericFields({ vo2max: 48.2, restingHr: 52 })).toEqual([
      { field: 'vo2max', value: 48.2 },
      { field: 'restingHr', value: 52 },
    ]);
  });

  it('takes booleans as 0/1 so a daily mean is a duty cycle', () => {
    expect(numericFields({ armed: true, away: false })).toEqual([
      { field: 'armed', value: 1 },
      { field: 'away', value: 0 },
    ]);
  });

  it('drops identifiers — the last_video_id lesson', () => {
    // The HA sweep registered `last_video_id` at 7.67e18: a number that changes
    // daily and correlates with nothing.
    const fields = numericFields({ accountId: 99, transactionId: 12, uuid: 5, balance: 120 });
    expect(fields.map((f) => f.field)).toEqual(['balance']);
  });

  it('drops a unix timestamp by magnitude', () => {
    // date_time_now returns ~1.7e12 and is enabled in production.
    expect(numericFields({ now: 1756598400000, hour: 22 }).map((f) => f.field)).toEqual(['hour']);
  });

  it('drops facts about the call rather than the world', () => {
    expect(numericFields({ count: 3, status: 200, temperature: 19.5 }).map((f) => f.field)).toEqual([
      'temperature',
    ]);
  });

  it('does not walk nested objects', () => {
    // Depth finds far more numbers and almost all of them are noise, and a deep
    // key's name means nothing on a chart three weeks later.
    expect(numericFields({ summary: { total: 5, mean: 2 }, score: 7 }).map((f) => f.field)).toEqual(['score']);
  });

  it('is empty for an array or a null', () => {
    expect(numericFields([1, 2, 3])).toEqual([]);
    expect(numericFields(null)).toEqual([]);
    expect(numericFields('nope')).toEqual([]);
  });

  it('ignores NaN and Infinity', () => {
    expect(numericFields({ a: NaN, b: Infinity, c: 1 }).map((f) => f.field)).toEqual(['c']);
  });
});

describe('sampleableTools', () => {
  it('takes only tools that need no arguments', async () => {
    h.tools = [tool('no_args'), tool('needs_city', ['city'])];
    expect((await sampleableTools()).map((t) => t.name)).toEqual(['no_args']);
  });

  it('treats a missing required array as no arguments', async () => {
    h.tools = [{ name: 'bare', description: null, parameters: {}, enabled: true }];
    expect((await sampleableTools()).map((t) => t.name)).toEqual(['bare']);
  });
});

describe('harvestToolSignals', () => {
  it('turns a tool that returns numbers into signals and readings', async () => {
    h.tools = [tool('vo2max_training_baseline')];
    vi.mocked(executeTool).mockResolvedValue(ok({ vo2max: 48.2, weeklyLoad: 310 }) as never);

    const harvest = await harvestToolSignals();
    expect(harvest.sampled).toBe(1);
    expect(harvest.specs.map((s) => s.key)).toEqual([
      'tool:vo2max_training_baseline#vo2max',
      'tool:vo2max_training_baseline#weeklyLoad',
    ]);
    expect(harvest.readings.map((r) => r.value)).toEqual([48.2, 310]);
    expect(harvest.specs.every((s) => s.source === 'tool')).toBe(true);
  });

  it('calls the tool with no arguments — it must never guess them', async () => {
    h.tools = [tool('family_movement_snapshot')];
    vi.mocked(executeTool).mockResolvedValue(ok({ moves: 3 }) as never);
    await harvestToolSignals();
    expect(executeTool).toHaveBeenCalledWith('family_movement_snapshot', {});
  });

  it('names a tool that returns nothing numeric rather than only counting it', async () => {
    // A tool worth deleting; a count alone never says which one.
    h.tools = [tool('prose_only')];
    vi.mocked(executeTool).mockResolvedValue(ok({ summary: 'all fine' }) as never);
    const harvest = await harvestToolSignals();
    expect(harvest.barren).toEqual(['prose_only']);
    expect(harvest.specs).toEqual([]);
  });

  it('records a failing tool without losing the rest of the run', async () => {
    h.tools = [tool('broken'), tool('fine')];
    vi.mocked(executeTool).mockImplementation((async (name: string) =>
      name === 'broken' ? { success: false, error: 'upstream 500' } : ok({ n: 1 })) as never);

    const harvest = await harvestToolSignals();
    expect(harvest.failed).toEqual([{ name: 'broken', error: 'upstream 500' }]);
    expect(harvest.readings).toHaveLength(1);
  });

  it('survives a tool that throws', async () => {
    h.tools = [tool('throws'), tool('fine')];
    vi.mocked(executeTool).mockImplementation((async (name: string) => {
      if (name === 'throws') throw new Error('boom');
      return ok({ n: 1 });
    }) as never);

    const harvest = await harvestToolSignals();
    expect(harvest.failed[0].name).toBe('throws');
    expect(harvest.readings).toHaveLength(1);
  });

  it('respects the per-run ceiling — every sample is a real call', async () => {
    h.tools = Array.from({ length: 40 }, (_, n) => tool(`t${n}`));
    vi.mocked(executeTool).mockResolvedValue(ok({ n: 1 }) as never);
    const harvest = await harvestToolSignals({ limit: 3 });
    expect(harvest.sampled).toBe(3);
    expect(vi.mocked(executeTool).mock.calls).toHaveLength(3);
  });

  it('has a default ceiling that cannot run away', () => {
    expect(MAX_TOOLS_PER_RUN).toBeLessThanOrEqual(30);
  });

  it('keys a signal so it reads back to the tool that made it', async () => {
    // `tool:<name>#<field>` is what lets the collector find the tool again
    // without a second table.
    h.tools = [tool('tfl_line_status')];
    vi.mocked(executeTool).mockResolvedValue(ok({ disruptions: 2 }) as never);
    const harvest = await harvestToolSignals();
    const key = harvest.specs[0].key;
    expect(key).toBe('tool:tfl_line_status#disruptions');
    expect(key.slice('tool:'.length).split('#')[0]).toBe('tfl_line_status');
  });
});
