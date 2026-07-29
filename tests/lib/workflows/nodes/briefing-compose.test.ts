import { describe, it, expect } from 'vitest';
import { briefingComposeExecutor } from '$lib/workflows/nodes/briefing-compose';
import type { ExecutionContext } from '$lib/workflows/types';

const ctx: ExecutionContext = {
  runId: 'test-run',
  workflowId: '',
  workspaceDir: '/tmp/test',
  dryRun: false,
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
  getOutgoingEdges: () => [],
  getIncomingEdges: () => [],
  getNodeConfig: () => undefined,
};

const HOME_WEATHER = {
  label: 'Home',
  nowC: 19.7,
  feelsLikeC: 19.1,
  condition: 'Overcast',
  dayCondition: 'Overcast',
  maxC: 22.4,
  minC: 18.3,
  precipProbMaxPct: 3,
  windKph: 15.1,
  windDir: 'SW',
  gustKph: 42.5,
  uvIndexMax: 2.8,
  sunrise: '05:12',
  sunset: '21:12',
  factors: [],
};

const HERE_WEATHER = {
  ...HOME_WEATHER,
  label: 'Cambridge Leisure Park, England',
  nowC: 22.7,
  condition: 'Clear',
  maxC: 34,
  minC: 18.2,
  uvIndexMax: 5.5,
  factors: ['Very hot — 34°C peak, stay out of afternoon sun'],
};

const AWAY_LOCATION = {
  home: { lat: 54.52037, lon: -1.57231, label: 'Home' },
  current: {
    lat: 52.190126,
    lon: 0.136185,
    label: 'Cambridge Leisure Park, England',
    isHome: false,
    distanceKm: 282.8,
    bearing: 'SSE',
    since: '2026-07-28T20:59:05+01:00',
    stale: false,
    entity: 'person.john',
  },
};

type Out = {
  facts: Array<{ section: string; label: string; value: string }>;
  gaps: Array<{ section: string; reason: string }>;
  sources: Array<{ key: string; status: string; detail: string }>;
  factSheet: string;
  gapSheet: string;
  headline: string;
  gapCount: number;
};

const run = (input: Record<string, unknown>, config: Record<string, unknown> = {}) =>
  briefingComposeExecutor.execute(input, config, ctx).then((r) => r.output as unknown as Out);

describe('briefingComposeExecutor', () => {
  it('records a failed source as a gap instead of dropping it silently', async () => {
    const out = await run({
      location: AWAY_LOCATION,
      weatherHome: HOME_WEATHER,
      weatherHere: HERE_WEATHER,
      sleep: { success: false, error: 'Unknown tool: site_health_sleep' },
    });

    const sleep = out.sources.find((s) => s.key === 'sleep');
    expect(sleep?.status).toBe('failed');
    expect(sleep?.detail).toContain('Unknown tool');
    expect(out.gaps.some((g) => g.section === 'Sleep')).toBe(true);
    // Nothing about sleep may reach the fact sheet the LLM is allowed to quote.
    expect(out.factSheet).not.toContain('Sleep');
  });

  it('never emits a fact for a source that produced nothing', async () => {
    const out = await run({ location: AWAY_LOCATION, weatherHome: HOME_WEATHER, weatherHere: HERE_WEATHER });
    const sections = new Set(out.facts.map((f) => f.section));
    expect(sections.has('Sleep')).toBe(false);
    expect(sections.has('Email')).toBe(false);
    expect(sections.has('Readiness')).toBe(false);
    // …and every one of them is named in the gap sheet.
    expect(out.gapSheet).toContain('Sleep');
    expect(out.gapSheet).toContain('Email');
    expect(out.gapSheet).toContain('UNAVAILABLE');
  });

  it('reports weather for home and for where you actually are, and compares them', async () => {
    const out = await run({ location: AWAY_LOCATION, weatherHome: HOME_WEATHER, weatherHere: HERE_WEATHER });

    expect(out.factSheet).toContain('[Weather · home]');
    expect(out.factSheet).toContain('[Weather · where you are]');
    expect(out.facts.find((f) => f.section === 'Weather · where you are' && f.label === 'vs home')?.value).toBe(
      '12°C warmer than home today',
    );
    expect(out.facts.find((f) => f.label === 'Local factors')?.value).toContain('Very hot');
    // Temperatures stay in °C — the old briefing converted them to °F.
    expect(out.factSheet).toContain('34°C');
    expect(out.factSheet).not.toContain('°F');
  });

  it('collapses the second forecast when you are at home', async () => {
    const out = await run({
      location: { home: { lat: 1, lon: 1, label: 'Home' }, current: { lat: 1, lon: 1, isHome: true, label: 'Home' } },
      weatherHome: HOME_WEATHER,
    });
    expect(out.factSheet).not.toContain('[Weather · where you are]');
    expect(out.sources.find((s) => s.key === 'weather-here')?.detail).toContain('you are at home');
  });

  it('marks partially-dead sensor sets as stale rather than ok', async () => {
    const out = await run({
      location: AWAY_LOCATION,
      indoor: {
        entities: [
          { entity_id: 'sensor.john_s_echo_temperature', friendly_name: "John's Echo", state: '23.5', attributes: { unit_of_measurement: '°C' } },
          { entity_id: 'sensor.downstairs_hallway_temperature', state: 'unavailable', attributes: {} },
        ],
      },
    });
    const indoor = out.sources.find((s) => s.key === 'indoor');
    expect(indoor?.status).toBe('stale');
    expect(indoor?.detail).toContain('sensor.downstairs_hallway_temperature');
    expect(out.facts.some((f) => f.value === '23.5°C')).toBe(true);
    // The unavailable sensor contributes no value at all.
    expect(out.facts.some((f) => f.label.includes('hallway'))).toBe(false);
    // …but a partly-reporting set is NOT a gap: the working sensor's value stands.
    expect(out.gaps.some((g) => g.section === 'Indoor sensors')).toBe(false);
  });

  it('produces a true headline without any LLM involvement', async () => {
    const out = await run({ location: AWAY_LOCATION, weatherHome: HOME_WEATHER, weatherHere: HERE_WEATHER });
    expect(out.headline).toBe('In Cambridge Leisure Park, England · Clear, up to 34°C');
  });

  it('surfaces upstream node failures the merged payload cannot show', async () => {
    const failing: ExecutionContext = {
      ...ctx,
      _currentNodeId: 'compose',
      getIncomingEdges: (id) =>
        id === 'compose'
          ? ([{ id: 'e1', sourceNodeId: 'gmail', targetNodeId: 'compose' }] as never)
          : ([] as never),
      getNodeError: (id) => (id === 'gmail' ? 'Gmail token refresh failed: invalid_grant' : undefined),
      getNodeConfig: (id) => (id === 'gmail' ? { type: 'gmail-search', config: {}, label: 'Overnight emails' } : undefined),
    };
    const { output } = await briefingComposeExecutor.execute({ location: AWAY_LOCATION }, {}, failing);
    const res = output as unknown as Out;
    const row = res.sources.find((s) => s.key === 'node:gmail-search');
    expect(row?.status).toBe('failed');
    expect(row?.detail).toContain('invalid_grant');
    // The Email section already raised the gap — the node row must not double it.
    expect(res.gaps.filter((g) => /email/i.test(g.section)).length).toBe(1);
  });

  it('counts gaps so a caller can refuse to send a mostly-empty briefing', async () => {
    const empty = await run({});
    expect(empty.gapCount).toBeGreaterThanOrEqual(6);
    expect(empty.factSheet).toBe('');
  });
});

describe('truth-required sources', () => {
  /** Build a context whose ancestor walk exposes one flagged source node. */
  function ctxWith(nodes: Array<{ id: string; type: string; config: Record<string, unknown>; label: string }>): ExecutionContext {
    return {
      ...ctx,
      _currentNodeId: 'compose',
      getIncomingEdges: (id) =>
        id === 'compose'
          ? (nodes.map((n, i) => ({ id: `e${i}`, sourceNodeId: n.id, targetNodeId: 'compose' })) as never)
          : ([] as never),
      getNodeConfig: (id) => nodes.find((n) => n.id === id),
    };
  }

  const SLEEP_REQUIRED = [
    { id: 'sleep', type: 'health-query', config: { operation: 'sleep', _truthRequired: true }, label: 'Sleep' },
  ];

  it('promotes a flagged source’s gap and leads the headline with it', async () => {
    const { output } = await briefingComposeExecutor.execute(
      { location: AWAY_LOCATION, weatherHome: HOME_WEATHER, weatherHere: HERE_WEATHER, sleep: { success: false, error: 'tool exploded' } },
      {},
      ctxWith(SLEEP_REQUIRED),
    );
    const out = output as unknown as Out & { truthCompromised: boolean; requiredGaps: Array<{ section: string }> };
    expect(out.truthCompromised).toBe(true);
    expect(out.requiredGaps.map((g) => g.section)).toEqual(['Sleep']);
    expect(out.headline.startsWith('⚠ Sleep unavailable')).toBe(true);
    expect(out.gapSheet).toContain('Sleep: UNAVAILABLE (REQUIRED)');
  });

  it('leaves unflagged gaps as ordinary footnotes', async () => {
    const { output } = await briefingComposeExecutor.execute(
      { location: AWAY_LOCATION, weatherHome: HOME_WEATHER, weatherHere: HERE_WEATHER, sleep: { success: false, error: 'tool exploded' } },
      {},
      ctxWith([{ id: 'sleep', type: 'health-query', config: { operation: 'sleep' }, label: 'Sleep' }]),
    );
    const out = output as unknown as Out & { truthCompromised: boolean };
    expect(out.truthCompromised).toBe(false);
    expect(out.headline.startsWith('⚠')).toBe(false);
    expect(out.gapSheet).toContain('Sleep: UNAVAILABLE —');
    expect(out.gapSheet).not.toContain('(REQUIRED)');
  });

  it('does not fire when the required source actually reported', async () => {
    const { output } = await briefingComposeExecutor.execute(
      {
        location: AWAY_LOCATION,
        weatherHome: HOME_WEATHER,
        weatherHere: HERE_WEATHER,
        sleep: { success: true, data: { latest: { totalDuration: 24930910, performance: 78, deepPercent: 24, remPercent: 24 } } },
      },
      {},
      ctxWith(SLEEP_REQUIRED),
    );
    const out = output as unknown as Out & { truthCompromised: boolean };
    expect(out.truthCompromised).toBe(false);
    expect(out.factSheet).toContain('Time in bed');
  });

  it('tells two same-type sources apart by their own config', async () => {
    // Only the HOME forecast is required; the "where I am" one is not.
    const nodes = [
      { id: 'wxh', type: 'weather-brief', config: { latitude: '{{input.home.lat}}', _truthRequired: true }, label: 'Weather · home' },
      { id: 'wxc', type: 'weather-brief', config: { latitude: '{{input.current.lat}}' }, label: 'Weather · here' },
    ];
    const { output } = await briefingComposeExecutor.execute(
      { location: AWAY_LOCATION, weatherHomeError: 'Open-Meteo 503', weatherHereError: 'Open-Meteo 503' },
      {},
      ctxWith(nodes),
    );
    const out = output as unknown as Out & { requiredGaps: Array<{ section: string }> };
    expect(out.requiredGaps.map((g) => g.section)).toEqual(['Weather · home']);
  });
});
