import { describe, it, expect, vi, afterEach } from 'vitest';
import { locationContextExecutor } from '$lib/workflows/nodes/location-context';
import * as service from '$lib/workflows/homeassistant/service';
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

const ZONE_HOME = {
  entity_id: 'zone.home',
  state: '4',
  attributes: { latitude: 54.52037, longitude: -1.57231, radius: 100, friendly_name: 'Home' },
};

const PERSON_AWAY = {
  entity_id: 'person.john',
  state: 'not_home',
  attributes: { latitude: 52.190126, longitude: 0.136185, gps_accuracy: 15, source: 'device_tracker.life360_john_kelly' },
  last_changed: '2026-07-28T19:46:22.505442+00:00',
};

const TRACKER = {
  entity_id: 'device_tracker.life360_john_kelly',
  state: 'not_home',
  attributes: {
    latitude: 52.190131,
    longitude: 0.136231,
    address: 'Cambridge Leisure Park, England',
    at_loc_since: '2026-07-28T20:59:05+01:00',
    last_seen: new Date().toISOString(),
    battery_level: 100,
    source_type: 'gps',
    driving: false,
  },
};

/** Stub the HA singleton with a fixed entity_id → state map. */
function mockHA(states: Record<string, unknown>) {
  return vi.spyOn(service, 'getHomeAssistantService').mockReturnValue({
    queryState: async (id: string) =>
      id in states ? { success: true, data: states[id] } : { success: false, error: 'HA API error: 404 Not Found' },
  } as unknown as ReturnType<typeof service.getHomeAssistantService>);
}

afterEach(() => vi.restoreAllMocks());

type Out = {
  success: boolean;
  away: boolean | null;
  home: Record<string, unknown> | null;
  current: Record<string, unknown> | null;
  error: string | null;
};
const run = (config: Record<string, unknown> = {}) =>
  locationContextExecutor
    .execute({}, { personEntity: 'person.john', homeZoneEntity: 'zone.home', ...config }, ctx)
    .then((r) => r.output as unknown as Out);

describe('locationContextExecutor', () => {
  it('resolves home and current position and the distance between them', async () => {
    mockHA({ 'zone.home': ZONE_HOME, 'person.john': PERSON_AWAY, 'device_tracker.life360_john_kelly': TRACKER });
    const out = await run();
    expect(out.success).toBe(true);
    expect(out.away).toBe(true);
    expect(out.home?.lat).toBe(54.52037);
    expect(out.current?.lat).toBe(52.190126);
    // Darlington → Cambridge is ~283 km.
    expect(out.current?.distanceKm).toBeGreaterThan(270);
    expect(out.current?.distanceKm).toBeLessThan(295);
    expect(out.current?.bearing).toBe('SSE');
  });

  it('follows person.source to the tracker for the street address', async () => {
    mockHA({ 'zone.home': ZONE_HOME, 'person.john': PERSON_AWAY, 'device_tracker.life360_john_kelly': TRACKER });
    const out = await run();
    expect(out.current?.label).toBe('Cambridge Leisure Park, England');
    expect(out.current?.batteryPct).toBe(100);
    // Position still comes from the person entity, not the tracker.
    expect(out.current?.lon).toBe(0.136185);
  });

  it('trusts Home Assistant state over the radius when at home', async () => {
    mockHA({
      'zone.home': ZONE_HOME,
      'person.john': { ...PERSON_AWAY, state: 'home', attributes: { latitude: 54.519624, longitude: -1.571872 } },
    });
    const out = await run();
    expect(out.current?.isHome).toBe(true);
    expect(out.away).toBe(false);
  });

  it('flags a stale fix rather than presenting it as current', async () => {
    const old = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    mockHA({
      'zone.home': ZONE_HOME,
      'person.john': PERSON_AWAY,
      'device_tracker.life360_john_kelly': { ...TRACKER, attributes: { ...TRACKER.attributes, last_seen: old } },
    });
    const out = await run({ staleAfterMins: 120 });
    expect(out.current?.stale).toBe(true);
    expect(out.current?.ageMins).toBeGreaterThan(120);
  });

  it('fails honestly when the entity is missing', async () => {
    mockHA({ 'zone.home': ZONE_HOME });
    const out = await run();
    expect(out.success).toBe(false);
    expect(out.current).toBeNull();
    expect(out.error).toContain('person.john');
  });

  it('fails honestly when the tracker reports no GPS fix', async () => {
    mockHA({ 'zone.home': ZONE_HOME, 'person.john': { entity_id: 'person.john', state: 'unknown', attributes: {} } });
    const out = await run();
    expect(out.success).toBe(false);
    expect(out.error).toContain('no GPS position');
  });
});
