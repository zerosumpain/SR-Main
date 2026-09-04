import { DEPENDENCY_POLL_INTERVAL_MS, worstState, type DependencyObservation } from './catalog';

const DEFAULT_GATUS_URL = 'http://100.83.68.108:8082';
const GATUS_TIMEOUT_MS = 5_000;
const SLOW_PUBLIC_CHECK_MS = 3_000;

interface GatusResult {
  duration?: number;
  success?: boolean;
  timestamp?: string;
}

interface GatusEndpoint {
  name?: string;
  results?: GatusResult[];
}

function endpointUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, '')}/api/v1/endpoints/${key}/statuses`;
}

/**
 * Collapse Gatus' homepage and application checks into one public-journey
 * observation per five-minute window. Gatus durations are nanoseconds.
 */
export function parseGatusPublicJourney(endpoints: GatusEndpoint[]): DependencyObservation[] {
  const buckets = new Map<number, Array<{ name: string; state: 'green' | 'amber' | 'red'; latencyMs: number }>>();

  for (const endpoint of endpoints) {
    for (const result of endpoint.results ?? []) {
      const checkedAt = new Date(result.timestamp ?? '');
      if (Number.isNaN(checkedAt.getTime()) || typeof result.success !== 'boolean') continue;
      const latencyMs = Math.max(0, Math.round(Number(result.duration ?? 0) / 1_000_000));
      const state = !result.success ? 'red' : latencyMs >= SLOW_PUBLIC_CHECK_MS ? 'amber' : 'green';
      const bucket = Math.floor(checkedAt.getTime() / DEPENDENCY_POLL_INTERVAL_MS)
        * DEPENDENCY_POLL_INTERVAL_MS;
      const values = buckets.get(bucket) ?? [];
      values.push({ name: endpoint.name ?? 'Public endpoint', state, latencyMs });
      buckets.set(bucket, values);
    }
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([checkedAt, values]) => {
      const state = worstState(values.map((value) => value.state));
      const affected = values.filter((value) => value.state !== 'green').map((value) => value.name);
      const latencyMs = Math.max(...values.map((value) => value.latencyMs));
      const checked = [...new Set(values.map((value) => value.name))].join(', ');
      const summary = state === 'green'
        ? `Independent public monitor reached: ${checked}`
        : state === 'amber'
          ? `Independent public monitor saw a slow response: ${affected.join(', ')}`
          : `Independent public monitor saw a failed response: ${affected.join(', ')}`;

      return {
        dependencyId: 'public-site',
        state,
        summary,
        checkedAt: new Date(checkedAt),
        latencyMs,
      };
    });
}

/** Read the independent Porkserv observations. Absence is non-fatal: the UI's
 * coverage metric makes missing external evidence visible. */
export async function readGatusPublicJourney(fetcher: typeof fetch = fetch): Promise<DependencyObservation[]> {
  const base = process.env.DEPENDENCY_GATUS_URL || DEFAULT_GATUS_URL;
  const responses = await Promise.allSettled([
    fetcher(endpointUrl(base, 'public-site_homepage'), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(GATUS_TIMEOUT_MS),
    }),
    fetcher(endpointUrl(base, 'public-site_application'), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(GATUS_TIMEOUT_MS),
    }),
  ]);

  const endpoints: GatusEndpoint[] = [];
  for (const response of responses) {
    if (response.status !== 'fulfilled' || !response.value.ok) continue;
    try {
      endpoints.push(await response.value.json() as GatusEndpoint);
    } catch {
      // One malformed endpoint should not hide usable evidence from the other.
    }
  }
  return parseGatusPublicJourney(endpoints);
}
