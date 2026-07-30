import { describe, it, expect } from 'vitest';
import { buildStories, classifyAction, resolveToolDriver, summariseStories } from './narrative';
import type { NarrativeInput, NarrativeRun } from './narrative';
import type { BacklogItemData, ImprovementRunData, QuestionInsights, RunAction } from './types';
import type { ToolPolicyVersion } from '$lib/toolpolicy/policy';

// Fixtures mirror the 2026-07-30 production run verbatim — the prose templates
// below are the ones the engine actually writes, so a reworded template breaks
// these tests rather than silently degrading the page.

function run(runId: string, createdAt: string, actions: RunAction[]): NarrativeRun {
  const data: ImprovementRunData = {
    status: 'complete',
    trigger: 'cron',
    startedAt: createdAt,
    finishedAt: createdAt,
    phases: {} as ImprovementRunData['phases'],
    llmCalls: 12,
    tokensIn: 100,
    tokensOut: 100,
    costUsd: 0.01,
    actions,
    report: '',
  };
  return { runId, createdAt, data };
}

const SHIPPED_SENSOR: RunAction = {
  kind: 'tool_shipped',
  detail:
    'home_sensor_status: Query the current state of one or more Home Assistant entities (e.g., sensors, binary sensors) by entity ID. Returns a map of entity_id to state object. Useful for checking battery levels, door/window contacts, motion sensors, etc. — live now',
};

const REJECTED_BALANCE: RunAction = {
  kind: 'tool_rejected',
  detail: 'openrouter_balance: 1/1 case(s) failed. First failure: args={} error=Credits field not found in response',
};

const REPAIRED_NEARBY: RunAction = {
  kind: 'tool_repaired',
  detail:
    'nearby_places: 0→2 of 3 smoke cases (was 80% errors over 5 runs) — Added input validation for lat/lon/radius/category types, User-Agent header to avoid Overpass rate limiting',
};

const REPAIR_REJECTED: RunAction = {
  kind: 'tool_rejected',
  detail: 'reverse_geocode (repair): candidate did not beat the incumbent (0/3 vs 3/3)',
};

const POLICY_PUBLISHED: RunAction = {
  kind: 'policy_published',
  detail:
    'v1 targets fetch_url (151 repeat calls over 9 turns) — The waste shows many distinct URLs were fetched. On trial from 4.31 calls/turn.',
};

const INSIGHTS: QuestionInsights = {
  period: '2026-31',
  generatedAt: '2026-07-30T02:30:00.000Z',
  topUnmet: ['Real-time home sensor data', 'Live OpenRouter account balance API'],
  intents: [
    {
      intent: 'home_status_check',
      count: 4,
      servedWell: false,
      missingCapability:
        'Real-time home sensor data (e.g., battery levels, security status) via Home Assistant',
      examples: ['whats the front door battery level', 'is everything secure?'],
    },
    {
      intent: 'openrouter_balance',
      count: 4,
      servedWell: false,
      missingCapability: 'Live OpenRouter account balance API',
      examples: ['whats my openrouter balance'],
    },
    {
      intent: 'heartbeat_confirmation',
      count: 12,
      servedWell: true,
    },
  ],
};

function backlogItem(patch: Partial<BacklogItemData> = {}): BacklogItemData {
  return {
    slug: 'real-time-home-sensor-data-battery-security',
    title: 'Real-time home sensor data (battery, security)',
    detail: 'Needs a Home Assistant read path',
    kind: 'tool',
    status: 'open',
    priority: 2,
    attempts: 0,
    createdAt: '2026-07-30T02:30:24.217Z',
    updatedAt: '2026-07-30T02:30:24.217Z',
    ...patch,
  };
}

function policyV1(patch: Partial<ToolPolicyVersion> = {}): ToolPolicyVersion {
  return {
    version: 1,
    createdAt: '2026-07-30T02:31:00.000Z',
    createdBy: 'engine',
    rationale: 'govuk_search can replace many fetches when the question is about UK government',
    targetTool: 'fetch_url',
    overrides: {},
    globalGuidance: [],
    promoteToEssential: [],
    parentVersion: 0,
    trial: {
      status: 'running',
      startedAt: '2026-07-30T02:31:00.000Z',
      baseline: { meanCalls: 4.31, turns: 158, repeatCalls: 439, generatedAt: '2026-07-30' } as never,
      turnsObserved: 3,
    },
    ...patch,
  };
}

function input(patch: Partial<NarrativeInput> = {}): NarrativeInput {
  return {
    runs: [],
    backlog: [],
    policyVersions: [],
    toolHealth: [],
    insights: null,
    ...patch,
  };
}

describe('classifyAction — which card an action belongs to', () => {
  const empty = new Map<number, ToolPolicyVersion>();

  it('routes a failed REPAIR to the repair card, not the build card', () => {
    const cls = classifyAction(REPAIR_REJECTED, empty);
    expect(cls).toMatchObject({ key: 'repair:reverse_geocode', kind: 'repair', subject: 'reverse_geocode' });
  });

  it('routes a failed BUILD to the tool card', () => {
    const cls = classifyAction(REJECTED_BALANCE, empty);
    expect(cls).toMatchObject({ key: 'tool:openrouter_balance', kind: 'tool' });
  });

  it('resolves a policy action to its target tool via the version record', () => {
    const byVersion = new Map([[1, policyV1()]]);
    const cls = classifyAction(POLICY_PUBLISHED, byVersion);
    expect(cls).toMatchObject({ key: 'policy:fetch_url', kind: 'policy' });
  });

  it('prefers the recorded subject over parsing the prose', () => {
    const cls = classifyAction(
      { kind: 'tool_shipped', detail: 'anything at all', story: { subject: 'explicit_name' } },
      empty,
    );
    expect(cls?.subject).toBe('explicit_name');
  });

  it('ignores actions that are context rather than improvements', () => {
    expect(classifyAction({ kind: 'insight', detail: '10 intents, 5 unmet' }, empty)).toBeNull();
    expect(classifyAction({ kind: 'efficiency_measured', detail: '4.31 calls/turn' }, empty)).toBeNull();
  });
});

describe('driver resolution — recorded beats inferred, inference is labelled', () => {
  it('uses what the engine recorded and marks it recorded', () => {
    const d = resolveToolDriver(
      'home_sensor_status',
      'reads sensors',
      { driver: 'You asked 4 times about door batteries.', driverEvidence: '4 questions' },
      [],
      INSIGHTS,
    );
    expect(d.linkConfidence).toBe('recorded');
    expect(d.driver).toBe('You asked 4 times about door batteries.');
  });

  it('infers the driver from the unmet intent when nothing was recorded', () => {
    const d = resolveToolDriver(
      'home_sensor_status',
      'Query the current state of Home Assistant entities. Useful for checking battery levels, door contacts, motion sensors.',
      undefined,
      [],
      INSIGHTS,
    );
    expect(d.linkConfidence).toBe('inferred');
    expect(d.driver).toContain('You asked 4 questions');
    expect(d.driver).toContain('Real-time home sensor data');
    expect(d.driverQuotes).toContain('whats the front door battery level');
  });

  it('never attaches a driver that shares no vocabulary with the tool', () => {
    const d = resolveToolDriver(
      'sausage_generator',
      'Produces a random sausage name for a joke command',
      undefined,
      [],
      INSIGHTS,
    );
    expect(d.linkConfidence).toBe('unknown');
    expect(d.driver).toMatch(/did not record/i);
  });

  it('does not match an intent that was already served well', () => {
    const d = resolveToolDriver(
      'heartbeat_confirmation_helper',
      'heartbeat confirmation checking in',
      undefined,
      [],
      INSIGHTS,
    );
    expect(d.linkConfidence).not.toBe('recorded');
    expect(d.driver).not.toContain('heartbeat');
  });

  it('follows an explicit backlog reference when one was stored', () => {
    const item = backlogItem();
    const d = resolveToolDriver('home_sensor_status', 'x', { driverRef: item.slug }, [item], null);
    expect(d.linkConfidence).toBe('recorded');
    expect(d.driver).toContain('Real-time home sensor data');
  });
});

describe('buildStories — one card per improvement', () => {
  it('tells a shipped tool as driver → solution → outcome', () => {
    const stories = buildStories(
      input({
        runs: [run('r1', '2026-07-30T02:30:00.000Z', [SHIPPED_SENSOR])],
        insights: INSIGHTS,
        toolHealth: [
          {
            name: 'home_sensor_status',
            description: 'Query the current state of Home Assistant entities by entity ID',
            enabled: true,
            runCount: 0,
            errorCount: 0,
          },
        ],
      }),
    );
    const card = stories.find((s) => s.subject === 'home_sensor_status');
    expect(card).toBeDefined();
    expect(card!.status).toBe('live');
    expect(card!.driver).toContain('Real-time home sensor data');
    expect(card!.solution).toContain('home_sensor_status');
    // Never claims a benefit it has not seen.
    expect(card!.outcomeKind).toBe('pending');
    expect(card!.outcome).toMatch(/not needed it yet|Not called yet/i);
  });

  it('reports calls SINCE shipping when the count was snapshotted', () => {
    const stories = buildStories(
      input({
        runs: [
          run('r1', '2026-07-20T02:30:00.000Z', [
            { ...SHIPPED_SENSOR, story: { runCountAtAction: 40 } },
          ]),
        ],
        toolHealth: [
          { name: 'home_sensor_status', enabled: true, runCount: 52, errorCount: 0 },
        ],
      }),
    );
    const card = stories.find((s) => s.subject === 'home_sensor_status')!;
    expect(card.outcomeKind).toBe('measured');
    expect(card.outcome).toContain('12 times');
  });

  it('marks a lifetime figure as such when no snapshot exists', () => {
    const stories = buildStories(
      input({
        runs: [run('r1', '2026-07-20T02:30:00.000Z', [SHIPPED_SENSOR])],
        toolHealth: [{ name: 'home_sensor_status', enabled: true, runCount: 9, errorCount: 2 }],
      }),
    );
    const card = stories.find((s) => s.subject === 'home_sensor_status')!;
    expect(card.outcome).toContain('lifetime');
    expect(card.outcome).toContain('2 errors');
  });

  it('threads a rejection and a later ship into ONE card', () => {
    const stories = buildStories(
      input({
        runs: [
          run('r1', '2026-07-28T02:30:00.000Z', [
            { kind: 'tool_rejected', detail: 'home_sensor_status: 1/2 case(s) failed' },
          ]),
          run('r2', '2026-07-30T02:30:00.000Z', [SHIPPED_SENSOR]),
        ],
        toolHealth: [{ name: 'home_sensor_status', enabled: true, runCount: 0, errorCount: 0 }],
      }),
    );
    const cards = stories.filter((s) => s.subject === 'home_sensor_status');
    expect(cards).toHaveLength(1);
    expect(cards[0].status).toBe('live');
    expect(cards[0].events.map((e) => e.label)).toEqual(['rejected', 'shipped']);
    expect(cards[0].solution).toContain('1 attempt');
  });

  it('keeps a build and a later repair as SEPARATE cards — different drivers', () => {
    const stories = buildStories(
      input({
        runs: [
          run('r1', '2026-07-01T02:30:00.000Z', [
            { kind: 'tool_shipped', detail: 'nearby_places: finds places nearby — live now' },
          ]),
          run('r2', '2026-07-30T02:30:00.000Z', [REPAIRED_NEARBY]),
        ],
        toolHealth: [{ name: 'nearby_places', enabled: true, runCount: 5, errorCount: 4 }],
      }),
    );
    expect(stories.filter((s) => s.subject === 'nearby_places')).toHaveLength(2);
    const repair = stories.find((s) => s.kind === 'repair')!;
    expect(repair.status).toBe('fixed');
    expect(repair.driverEvidence).toContain('80%');
    expect(repair.outcome).toContain('0→2 of 3 smoke cases');
  });

  it('says plainly that a failed repair changed nothing', () => {
    const stories = buildStories(
      input({
        runs: [run('r1', '2026-07-30T02:30:00.000Z', [REPAIR_REJECTED])],
        toolHealth: [{ name: 'reverse_geocode', enabled: true, runCount: 572, errorCount: 398 }],
      }),
    );
    const card = stories.find((s) => s.kind === 'repair')!;
    expect(card.status).toBe('rejected');
    expect(card.outcome).toMatch(/nothing was swapped in/i);
    expect(card.driverEvidence).toContain('70%');
  });

  it('explains a policy trial including how it will be judged', () => {
    const stories = buildStories(
      input({
        runs: [run('r1', '2026-07-30T02:30:00.000Z', [POLICY_PUBLISHED])],
        policyVersions: [policyV1()],
      }),
    );
    const card = stories.find((s) => s.kind === 'policy')!;
    expect(card.status).toBe('trial');
    expect(card.driverEvidence).toContain('151 repeated calls');
    expect(card.solution).toContain('No code changed');
    expect(card.outcome).toContain('3 of 30');
    expect(card.outcomeKind).toBe('expected');
  });

  it('reports a rolled-back overlay as a result, not a failure to hide', () => {
    const reverted = policyV1({
      trial: {
        status: 'reverted',
        startedAt: '2026-07-10T00:00:00.000Z',
        baseline: { meanCalls: 4.31 } as never,
        result: { meanCalls: 4.4 } as never,
        turnsObserved: 31,
        verdict: 'no improvement (4.31 → 4.4)',
      },
    });
    const stories = buildStories(
      input({
        runs: [run('r1', '2026-07-30T02:30:00.000Z', [{ kind: 'policy_reverted', detail: 'v1 rolled back' }])],
        policyVersions: [reverted],
      }),
    );
    const card = stories.find((s) => s.kind === 'policy')!;
    expect(card.status).toBe('reverted');
    expect(card.outcome).toContain('4.31 → 4.4');
  });

  it('hides a queued idea once its tool has shipped', () => {
    const shippedItem = backlogItem({ status: 'shipped' });
    const stories = buildStories(
      input({
        runs: [run('r1', '2026-07-30T02:30:00.000Z', [{ kind: 'backlog_added', detail: shippedItem.slug }])],
        backlog: [shippedItem],
      }),
    );
    expect(stories.filter((s) => s.kind === 'idea')).toHaveLength(0);
  });

  it('flags a queued idea a shipped tool already covers', () => {
    const item = backlogItem();
    const stories = buildStories(
      input({
        runs: [
          run('r1', '2026-07-30T02:30:00.000Z', [
            { kind: 'backlog_added', detail: item.slug },
            SHIPPED_SENSOR,
          ]),
        ],
        backlog: [item],
        insights: INSIGHTS,
        toolHealth: [
          {
            name: 'home_sensor_status',
            description: 'Query Home Assistant entities: battery levels, door contacts, motion sensors',
            enabled: true,
            runCount: 0,
            errorCount: 0,
          },
        ],
      }),
    );
    const idea = stories.find((s) => s.kind === 'idea')!;
    expect(idea.note).toContain('home_sensor_status');
    expect(idea.note).toContain('may be built twice');
  });

  it('does NOT flag an unrelated idea that merely shares generic words', () => {
    // Regression from real data: "Live OpenRouter balance" was flagged as served
    // by `govuk_search` on the strength of "live" and "api" alone.
    const unrelated = backlogItem({
      slug: 'live-openrouter-balance',
      title: 'Live OpenRouter balance',
      detail: 'Needs a live API for the account credit balance',
    });
    const stories = buildStories(
      input({
        runs: [
          run('r1', '2026-07-30T02:30:00.000Z', [
            { kind: 'backlog_added', detail: unrelated.slug },
            {
              kind: 'tool_shipped',
              detail:
                'govuk_search: Search the GOV.UK content API for UK government publications and live up-to-date policy pages — live now',
            },
          ]),
        ],
        backlog: [unrelated],
        toolHealth: [
          {
            name: 'govuk_search',
            description:
              'Search the GOV.UK content API for UK government publications and live up-to-date policy pages',
            enabled: true,
            runCount: 0,
            errorCount: 0,
          },
        ],
      }),
    );
    expect(stories.find((s) => s.kind === 'idea')!.note).toBeUndefined();
  });

  it('shows an open idea with its last failure fed forward', () => {
    const item = backlogItem({ attempts: 2, lastError: 'HTTP 405 from the upstream endpoint' });
    const stories = buildStories(
      input({
        runs: [run('r1', '2026-07-30T02:30:00.000Z', [{ kind: 'backlog_added', detail: item.slug }])],
        backlog: [item],
      }),
    );
    const card = stories.find((s) => s.kind === 'idea')!;
    expect(card.status).toBe('queued');
    expect(card.statusLabel).toContain('2 times');
    expect(card.outcome).toContain('HTTP 405');
  });

  it('orders live work ahead of queued ideas from the same night', () => {
    const item = backlogItem();
    const stories = buildStories(
      input({
        runs: [
          run('r1', '2026-07-30T02:30:00.000Z', [
            { kind: 'backlog_added', detail: item.slug },
            SHIPPED_SENSOR,
          ]),
        ],
        backlog: [item],
        toolHealth: [{ name: 'home_sensor_status', enabled: true, runCount: 0, errorCount: 0 }],
      }),
    );
    expect(stories[0].kind).toBe('tool');
  });

  it('survives an empty ledger', () => {
    expect(buildStories(input())).toEqual([]);
    expect(summariseStories([])).toEqual({ live: 0, fixed: 0, onTrial: 0, queued: 0, rejected: 0 });
  });

  it('never invents an outcome for a tool that has vanished from the registry', () => {
    const stories = buildStories(
      input({ runs: [run('r1', '2026-07-30T02:30:00.000Z', [SHIPPED_SENSOR])], toolHealth: [] }),
    );
    const card = stories[0];
    expect(card.outcome).toMatch(/no longer in the tool registry/i);
  });
});
