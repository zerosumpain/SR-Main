import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  /** Queue of parsed LLM responses, consumed in order by the fake budget. */
  responses: [] as unknown[],
  /** Result of the next executeTool smoke invocation, keyed by call index. */
  smokeResults: [] as Array<{ success: boolean; error?: string }>,
  inserted: [] as Array<Record<string, unknown>>,
  registered: new Set<string>(),
  existingNames: [] as string[],
  addedIdeas: [] as Array<{ title: string }>,
  markedAttempts: [] as Array<{ slug: string; status: string; error?: string }>,
  /** Backlog as `listBacklog()` sees it — set per test to drive attribution. */
  backlog: [] as Array<{ slug: string; title: string; detail: string }>,
}));

vi.mock('$lib/db', () => ({
  db: {
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        h.inserted.push(v);
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (h.existingNames.length ? [{ name: h.existingNames[0] }] : []),
        }),
      }),
    }),
  },
}));

vi.mock('$lib/datastore', () => ({ upsertRecord: vi.fn().mockResolvedValue({ id: 'a' }) }));

vi.mock('./context', () => ({
  buildContextPack: vi.fn().mockResolvedValue({
    platformTools: [],
    catalogApis: [],
    secretHandles: [],
    customTools: [],
    priorFailures: [],
    backlog: [],
  }),
  renderContext: () => 'CONTEXT',
}));

vi.mock('./backlog', () => ({
  addIdeas: vi.fn(async (ideas: Array<{ title: string }>) => {
    h.addedIdeas.push(...ideas);
    return ideas.map((i) => i.title.toLowerCase().replace(/\s+/g, '-'));
  }),
  markAttempt: vi.fn(async (item: { slug: string }, o: { status: string; error?: string }) => {
    h.markedAttempts.push({ slug: item.slug, status: o.status, error: o.error });
  }),
  pickWork: vi.fn(() => []),
  // Re-read after this run's ideas are queued, so a tool built tonight can be
  // linked to an idea queued tonight — see the driver-attribution fix.
  listBacklog: vi.fn(async () => h.backlog),
}));

vi.mock('$lib/workflows/site-tools/registry-internal', () => ({
  register: vi.fn((t: { name: string }) => h.registered.add(t.name)),
  unregister: vi.fn((n: string) => h.registered.delete(n)),
  isRegisteredTool: vi.fn((n: string) => h.registered.has(n)),
}));

vi.mock('$lib/workflows/site-tools/custom-tool-loader', () => ({
  buildHandler: vi.fn(() => async () => ({ success: true })),
}));

vi.mock('$lib/workflows/site-tools/registry', () => ({
  executeTool: vi.fn(async () => h.smokeResults.shift() ?? { success: true }),
}));

import { buildTool, coerceSpec } from './toolsmith';
import type { Budget } from './run';

/** Budget that replays queued responses and counts calls. */
function fakeBudget(timeLeft = 10 * 60 * 1000): Budget & { calls: number } {
  const b = {
    llmCalls: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    exceeded: false,
    calls: 0,
    timeLeftMs: () => timeLeft,
    async call() {
      b.calls++;
      const json = h.responses.shift() ?? null;
      return { content: JSON.stringify(json), json };
    },
  };
  return b as Budget & { calls: number };
}

const GOOD_CODE = "const r = await fetch('https://x'); return { success: true, data: 1 };";

function toolJson(over: Record<string, unknown> = {}) {
  return {
    name: 'my_tool',
    description: 'Does a thing',
    toolset: 'self-improve',
    parameters: { type: 'object', properties: {}, required: [] },
    handler_code: GOOD_CODE,
    smoke_cases: [{ args: { a: 1 } }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.responses = [];
  h.smokeResults = [];
  h.inserted = [];
  h.registered = new Set();
  h.existingNames = [];
  h.addedIdeas = [];
  h.markedAttempts = [];
  h.backlog = [];
});

describe('buildTool — driver attribution (the link the ledger reads)', () => {
  const SENSOR_IDEA = {
    slug: 'real-time-home-sensor-data-battery-security',
    title: 'Real-time home sensor data (battery, security)',
    detail: 'Needs a Home Assistant read path for battery levels and door contacts',
  };

  it('closes the backlog item a shipped tool serves, matching on `serves`', async () => {
    // The regression this pins: on 30 Jul the engine shipped home_sensor_status
    // and govuk_search while leaving both driving ideas open at attempts:0,
    // because it only searched items picked BEFORE this run queued them.
    h.backlog = [SENSOR_IDEA];
    h.responses = [
      {
        tools: [
          toolJson({
            name: 'home_sensor_status',
            description: 'Query the current state of Home Assistant entities by entity ID',
            serves: 'Real-time home sensor data (battery, security)',
          }),
        ],
        ideas: [],
      },
    ];

    const actions = await buildTool(undefined, undefined, fakeBudget(), 'run1');

    expect(h.markedAttempts).toContainEqual(
      expect.objectContaining({ slug: SENSOR_IDEA.slug, status: 'shipped' }),
    );
    const shipped = actions.find((a) => a.kind === 'tool_shipped');
    expect(shipped?.story?.driverRef).toBe(SENSOR_IDEA.slug);
    expect(shipped?.story?.driver).toContain('Real-time home sensor data');
    expect(shipped?.story?.subject).toBe('home_sensor_status');
  });

  it('still attributes when `serves` is absent, via description overlap', async () => {
    h.backlog = [SENSOR_IDEA];
    h.responses = [
      {
        tools: [
          toolJson({
            name: 'home_sensor_status',
            description:
              'Reads real-time home sensor data from Home Assistant: battery levels, door contacts and security status',
          }),
        ],
        ideas: [],
      },
    ];

    await buildTool(undefined, undefined, fakeBudget(), 'run1');
    expect(h.markedAttempts).toContainEqual(
      expect.objectContaining({ slug: SENSOR_IDEA.slug, status: 'shipped' }),
    );
  });

  it('does NOT attribute an unrelated tool to a queued idea', async () => {
    h.backlog = [SENSOR_IDEA];
    h.responses = [
      {
        tools: [
          toolJson({
            name: 'timezone_converter',
            description: 'Converts a timestamp between two named timezones',
            serves: 'Converting timestamps between timezones',
          }),
        ],
        ideas: [],
      },
    ];

    const actions = await buildTool(undefined, undefined, fakeBudget(), 'run1');
    expect(h.markedAttempts).toHaveLength(0);
    // The driver still reads as plain English, taken from `serves`.
    expect(actions.find((a) => a.kind === 'tool_shipped')?.story?.driver).toContain('timezones');
  });

  it('leaves the driver UNSET when nothing about the reason is known', async () => {
    // The ledger treats any stored driver as `recorded`. Writing a "the need was
    // not recorded" sentence here would stamp full confidence on text that
    // admits it knows nothing; unset lets the ledger infer and label honestly.
    h.backlog = [];
    h.responses = [
      { tools: [toolJson({ name: 'mystery_tool', description: 'Does something unrelated' })], ideas: [] },
    ];
    const actions = await buildTool(undefined, undefined, fakeBudget(), 'run1');
    const shipped = actions.find((a) => a.kind === 'tool_shipped');
    expect(shipped?.story).toBeDefined();
    expect(shipped?.story?.driver).toBeUndefined();
    expect(shipped?.story?.driverRef).toBeUndefined();
  });

  it('records the failure reason as the outcome on a rejected build', async () => {
    h.responses = [{ tools: [toolJson({ name: 'bad_tool' })], ideas: [] }, {}];
    h.smokeResults = [{ success: false, error: 'HTTP 405' }];

    const actions = await buildTool(undefined, undefined, fakeBudget(), 'run1');
    const rejected = actions.find((a) => a.kind === 'tool_rejected');
    expect(rejected?.story?.subject).toBe('bad_tool');
    expect(rejected?.story?.outcome).toBeTruthy();
  });
});

describe('buildTool — shipping is the whole point', () => {
  it('ships a passing tool ENABLED and leaves it registered (live without a restart)', async () => {
    h.responses = [{ tools: [toolJson()], ideas: [] }];
    const actions = await buildTool(undefined, undefined, fakeBudget(), 'run1');

    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0].enabled).toBe(true);
    expect(h.inserted[0].createdBy).toBe('self-improvement');
    // Still registered => callable in this process immediately.
    expect(h.registered.has('my_tool')).toBe(true);
    expect(actions.map((a) => a.kind)).toContain('tool_shipped');
  });

  it('builds MULTIPLE tools in one night', async () => {
    h.responses = [
      {
        tools: [toolJson({ name: 'tool_a' }), toolJson({ name: 'tool_b' }), toolJson({ name: 'tool_c' })],
        ideas: [],
      },
    ];
    const actions = await buildTool(undefined, undefined, fakeBudget(), 'run1');
    expect(actions.filter((a) => a.kind === 'tool_shipped')).toHaveLength(3);
    expect(h.inserted).toHaveLength(3);
  });

  it('REPAIRS a failing tool and ships the fix — the loop the old engine lacked', async () => {
    h.responses = [
      { tools: [toolJson()], ideas: [] },
      // repair round 1 returns corrected code
      toolJson({ handler_code: "const r = await fetch('https://y'); return { success: true };" }),
    ];
    // First smoke fails (the 405 case), second succeeds.
    h.smokeResults = [{ success: false, error: 'HTTP 405' }, { success: true }];

    const budget = fakeBudget();
    const actions = await buildTool(undefined, undefined, budget, 'run1');

    expect(budget.calls).toBe(2); // author + one repair
    const shipped = actions.find((a) => a.kind === 'tool_shipped');
    expect(shipped).toBeDefined();
    expect(shipped!.detail).toContain('fixed after 1 repair round');
    expect(h.inserted).toHaveLength(1);
  });

  it('gives up after the repair cap and queues the failure for tomorrow', async () => {
    h.responses = [
      { tools: [toolJson()], ideas: [] },
      toolJson({ handler_code: 'return { success: false };' }),
      toolJson({ handler_code: 'return { success: false };' }),
    ];
    h.smokeResults = [
      { success: false, error: 'HTTP 405' },
      { success: false, error: 'HTTP 405' },
      { success: false, error: 'HTTP 405' },
    ];

    const actions = await buildTool(undefined, undefined, fakeBudget(), 'run1');

    expect(actions.map((a) => a.kind)).toContain('tool_rejected');
    expect(h.inserted).toHaveLength(0);
    expect(h.registered.size).toBe(0); // nothing left registered
    // The failure became durable work rather than a dead string.
    expect(h.addedIdeas.length).toBeGreaterThan(0);
  });

  it('refuses a handler that fails the static scan without ever registering it', async () => {
    h.responses = [
      { tools: [toolJson({ handler_code: 'return { success: true, data: process.env.SECRET };' })], ideas: [] },
      // no usable repair
      null,
    ];
    const actions = await buildTool(undefined, undefined, fakeBudget(), 'run1');

    expect(h.registered.size).toBe(0);
    expect(h.inserted).toHaveLength(0);
    const rejected = actions.find((a) => a.kind === 'tool_rejected');
    expect(rejected!.detail).toMatch(/static scan/);
  });

  it('refuses to overwrite an existing tool name', async () => {
    h.existingNames = ['my_tool'];
    h.responses = [{ tools: [toolJson()], ideas: [] }, null];
    const actions = await buildTool(undefined, undefined, fakeBudget(), 'run1');
    expect(h.inserted).toHaveLength(0);
    expect(actions.find((a) => a.kind === 'tool_rejected')!.detail).toMatch(/already exists/);
  });

  it('queues ideas even when it ships nothing', async () => {
    h.responses = [{ tools: [], ideas: [{ title: 'Big feature', detail: 'd', kind: 'feature' }] }];
    const actions = await buildTool(undefined, undefined, fakeBudget(), 'run1');
    expect(h.addedIdeas).toHaveLength(1);
    expect(actions.map((a) => a.kind)).toContain('backlog_added');
  });

  it('stops building when the wall-clock budget runs out', async () => {
    h.responses = [{ tools: [toolJson({ name: 'tool_a' }), toolJson({ name: 'tool_b' })], ideas: [] }];
    const actions = await buildTool(undefined, undefined, fakeBudget(1000), 'run1');
    expect(h.inserted).toHaveLength(0);
    expect(actions.some((a) => a.detail.includes('wall-clock'))).toBe(true);
  });
});

describe('coerceSpec', () => {
  it('rejects a spec with required params but no smoke case — unverifiable cannot ship', () => {
    const spec = coerceSpec({
      ...toolJson({ smoke_cases: [] }),
      parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    });
    expect(spec).toBeNull();
  });

  it('allows an empty-args case when nothing is required', () => {
    const spec = coerceSpec(toolJson({ smoke_cases: [] }));
    expect(spec?.smoke_cases).toEqual([{ args: {} }]);
  });

  it('rejects invalid names and missing code', () => {
    expect(coerceSpec(toolJson({ name: 'Bad-Name' }))).toBeNull();
    expect(coerceSpec(toolJson({ handler_code: '' }))).toBeNull();
  });
});
