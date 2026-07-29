import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { getHomeAssistantService } from '../homeassistant/service';

export { locationContextDef } from './location-context.def';

type HAState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
  last_reported?: string;
};

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Great-circle distance in km. */
function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing home→current, as a compass point. */
function compass(aLat: number, aLon: number, bLat: number, bLon: number): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(bLon - aLon)) * Math.cos(toRad(bLat));
  const x =
    Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) -
    Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLon - aLon));
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

async function fetchState(entityId: string): Promise<HAState | null> {
  const res = await getHomeAssistantService().queryState(entityId);
  if (!res.success || !res.data) return null;
  return res.data as HAState;
}

export const locationContextExecutor: NodeExecutor = {
  type: 'location-context',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const personEntity = interpolateTemplate(String(config.personEntity ?? 'person.john'), input).trim();
    const homeZoneEntity = interpolateTemplate(String(config.homeZoneEntity ?? 'zone.home'), input).trim();
    const staleAfterMins = Math.max(Number(config.staleAfterMins) || 120, 1);

    if (!personEntity) {
      return {
        output: { success: false, error: 'location-context: personEntity is required', home: null, current: null, away: null },
        rowCount: 1,
      };
    }

    const errors: string[] = [];

    // --- Home ------------------------------------------------------------
    let home: Record<string, unknown> | null = null;
    const zone = await fetchState(homeZoneEntity).catch(() => null);
    const zLat = num(zone?.attributes.latitude);
    const zLon = num(zone?.attributes.longitude);
    if (zLat !== null && zLon !== null) {
      home = {
        lat: zLat,
        lon: zLon,
        label: str(zone?.attributes.friendly_name) ?? 'Home',
        radiusM: num(zone?.attributes.radius),
        entity: homeZoneEntity,
      };
    } else {
      errors.push(`home zone "${homeZoneEntity}" has no coordinates`);
    }

    // --- Current position ------------------------------------------------
    // person.* entities carry lat/lon but not the richer tracker attributes
    // (street address, battery, driving). Follow `source` to the underlying
    // device_tracker for those, keeping the person entity as the position.
    let current: Record<string, unknown> | null = null;
    const person = await fetchState(personEntity).catch(() => null);
    if (!person) {
      errors.push(`entity "${personEntity}" not found or Home Assistant unreachable`);
    } else {
      const source = str(person.attributes.source);
      const tracker = source && source !== personEntity ? await fetchState(source).catch(() => null) : null;
      const attrs: Record<string, unknown> = { ...(tracker?.attributes ?? {}), ...person.attributes };

      const lat = num(person.attributes.latitude) ?? num(tracker?.attributes.latitude);
      const lon = num(person.attributes.longitude) ?? num(tracker?.attributes.longitude);

      if (lat === null || lon === null) {
        errors.push(`entity "${personEntity}" reported no GPS position (state: ${person.state})`);
      } else {
        const seenIso =
          str(attrs.last_seen) ?? person.last_reported ?? person.last_updated ?? person.last_changed ?? null;
        const seenMs = seenIso ? Date.parse(seenIso) : NaN;
        const ageMins = Number.isFinite(seenMs) ? Math.max(0, Math.round((Date.now() - seenMs) / 60000)) : null;

        const distanceKm =
          home && typeof home.lat === 'number' && typeof home.lon === 'number'
            ? Math.round(haversineKm(home.lat as number, home.lon as number, lat, lon) * 10) / 10
            : null;

        // HA's own zone logic is authoritative for "am I home"; fall back to
        // the zone radius only when the state string is not a zone verdict.
        const isHome =
          person.state === 'home' ? true : person.state === 'not_home' ? false : distanceKm !== null && distanceKm < 0.15;

        current = {
          lat,
          lon,
          label: str(attrs.address) ?? str(attrs.place) ?? (isHome ? (home?.label ?? 'Home') : null) ?? person.state,
          state: person.state,
          isHome,
          distanceKm,
          bearing:
            home && !isHome && typeof home.lat === 'number' && typeof home.lon === 'number'
              ? compass(home.lat as number, home.lon as number, lat, lon)
              : null,
          source: source ?? personEntity,
          sourceType: str(attrs.source_type),
          since: str(attrs.at_loc_since) ?? person.last_changed ?? null,
          lastSeen: seenIso,
          ageMins,
          stale: ageMins !== null ? ageMins > staleAfterMins : false,
          accuracyM: num(attrs.gps_accuracy),
          batteryPct: num(attrs.battery_level),
          driving: attrs.driving === true,
          entity: personEntity,
        };
      }
    }

    const success = current !== null && home !== null;
    return {
      output: {
        success,
        away: current ? current.isHome !== true : null,
        home,
        current,
        error: errors.length ? errors.join('; ') : null,
      },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation in the entity config fields' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean', description: 'True only when both home and current position resolved' },
        away: { type: 'boolean', description: 'True when the person is not at home' },
        home: { type: 'object', description: '{ lat, lon, label, radiusM, entity } — null when the zone has no coordinates' },
        current: {
          type: 'object',
          description:
            '{ lat, lon, label, state, isHome, distanceKm, bearing, source, since, lastSeen, ageMins, stale, accuracyM, batteryPct, driving }',
        },
        error: { type: 'string', description: 'Why a part is missing; null on full success' },
      },
    };
  },
};
