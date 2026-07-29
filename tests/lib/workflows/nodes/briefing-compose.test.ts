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
