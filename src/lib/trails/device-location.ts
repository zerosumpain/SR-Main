// Default start for the planner: the last place Home Assistant saw John's
// device. Config comes straight from the `home_assistant_config` row (the
// connector-probe pattern) rather than the workflow singleton, because the
// singleton is only booted where RUN_PLATFORM_SERVICES is set and a page load
// must not depend on that.
//
// person.* entities carry lat/lon but not the richer tracker attributes;
// follow `source` to the device_tracker when the person has no fix — the same
// fallthrough the location-context workflow node uses.

const PERSON_ENTITY = 'person.john';

/** A fix older than this still seeds the map, but is flagged as stale. */
const STALE_AFTER_MINS = 360;

const FETCH_TIMEOUT_MS = 4000;

export interface HAStateLike {
  state?: string;
  attributes?: Record<string, unknown>;
  last_updated?: string;
  last_changed?: string;
  last_reported?: string;
}

export interface DeviceLocation {
  lat: number;
  lng: number;
  /** Where HA thinks that is — zone name, address, or the raw state. */
  label: string;
  ageMins: number | null;
  stale: boolean;
  entity: string;
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Pure: person state (+ optional source tracker) → a usable location, or null. */
export function pickLocation(
  person: HAStateLike | null,
  tracker: HAStateLike | null,
  now = Date.now(),
): DeviceLocation | null {
  if (!person) return null;
  const attrs: Record<string, unknown> = {
    ...(tracker?.attributes ?? {}),
    ...(person.attributes ?? {}),
  };

  const lat = num(person.attributes?.latitude) ?? num(tracker?.attributes?.latitude);
  const lng = num(person.attributes?.longitude) ?? num(tracker?.attributes?.longitude);
  if (lat === null || lng === null) return null;

  const seenIso =
    str(attrs.last_seen) ??
    person.last_reported ??
    person.last_updated ??
    person.last_changed ??
    null;
  const seenMs = seenIso ? Date.parse(seenIso) : NaN;
  const ageMins = Number.isFinite(seenMs) ? Math.max(0, Math.round((now - seenMs) / 60000)) : null;

  const state = str(person.state);
  const label =
    str(attrs.address) ??
    str(attrs.place) ??
    (state === 'home' ? 'Home' : state === 'not_home' ? 'Away' : (state ?? 'Unknown'));

  return {
    lat,
    lng,
    label,
    ageMins,
    stale: ageMins !== null && ageMins > STALE_AFTER_MINS,
    entity: PERSON_ENTITY,
  };
}

/**
 * Last known location of the john device, or null when HA is unconfigured,
 * unreachable, or has no fix. Never throws — this seeds a map default and a
 * dead integration must not stop the planner loading.
 */
export async function lastKnownDeviceLocation(): Promise<DeviceLocation | null> {
  try {
    const { db } = await import('$lib/db');
    const { homeAssistantConfig } = await import('$lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const [cfg] = await db
      .select()
      .from(homeAssistantConfig)
      .where(eq(homeAssistantConfig.id, 'default'))
      .limit(1);
    if (!cfg?.token) return null;

    const base = cfg.url.replace(/\/$/, '');
    const fetchState = async (entityId: string): Promise<HAStateLike | null> => {
      const res = await fetch(`${base}/api/states/${entityId}`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      return (await res.json()) as HAStateLike;
    };

    const person = await fetchState(PERSON_ENTITY);
    if (!person) return null;

    const source = str(person.attributes?.source);
    const tracker =
      source && source !== PERSON_ENTITY ? await fetchState(source).catch(() => null) : null;

    return pickLocation(person, tracker);
  } catch (err) {
    console.warn('[trails/device-location] lookup failed:', (err as Error)?.message);
    return null;
  }
}
