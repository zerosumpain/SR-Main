// /home/devices — the house's Home Assistant integrations, graded. PURE: the
// HA read is in `devices.server.ts`; this turns its answer into rows.
//
// One template call returns every config entry (domain, title, state) and
// every entity that belongs to one. An integration is judged by its entry's
// state first — Hue sat in `setup_retry` for days with 135 of 135 entities
// unavailable, which is "down", not "135 problems" — and then by how many of
// its entities are unavailable.

export type Verdict = 'down' | 'degraded' | 'watch' | 'ok' | 'off';

/** `[domain, title, state, disabled_by]` per config entry id. */
export type EntryMeta = [string, string, string, string];
/** `[entry id, entity_id, state, last_changed, device_class, battery_level, name]`. */
export type EntityRow = [string, string, string, string, string | null, number | string | null, string | null];

export interface DevicesPayload {
  entries: Record<string, EntryMeta>;
  rows: EntityRow[];
}

export interface IntegrationHealth {
  id: string;
  domain: string;
  label: string;
  /** The entry's own title when it says something the label does not. */
  title: string | null;
  state: string;
  verdict: Verdict;
  entities: number;
  unavailable: number;
  /** A few of the unavailable ones, by name, for the row's detail. */
  unavailableNames: string[];
  lastChangeAt: string | null;
}

export interface BatteryReading {
  entityId: string;
  name: string;
  level: number;
  /**
   * A person's phone rather than the house's kit (Life360, the HA companion
   * app, a device tracker). Its level is where-they-are-adjacent data that
   * /home/people deliberately scopes, so only the owner sees it here
   * (`houseOnly`).
   */
  personal: boolean;
}

/** Integrations whose batteries are a person's phone, not the house's kit. */
const PERSONAL_DOMAINS = new Set(['life360', 'mobile_app']);

/**
 * The summary with every person's phone taken out — for anyone but the owner:
 * their batteries, and the people integrations themselves (whose unavailable
 * entities are named after the person).
 */
export function houseOnly(summary: DevicesSummary): DevicesSummary {
  const integrations = summary.integrations.filter((i) => !PERSONAL_DOMAINS.has(i.domain));
  const counts: Record<Verdict, number> = { down: 0, degraded: 0, watch: 0, ok: 0, off: 0 };
  for (const i of integrations) counts[i.verdict]++;
  return {
    integrations,
    batteries: summary.batteries.filter((b) => !b.personal),
    counts,
    entities: integrations.reduce((n, i) => n + i.entities, 0),
    unavailable: integrations.reduce((n, i) => n + i.unavailable, 0),
  };
}

export interface DevicesSummary {
  integrations: IntegrationHealth[];
  batteries: BatteryReading[];
  counts: Record<Verdict, number>;
  entities: number;
  unavailable: number;
}

/** What each integration is to a person, not to HA. */
const LABEL: Record<string, string> = {
  alexa_devices: 'Alexa',
  hue: 'Philips Hue',
  tado: 'Tado heating',
  ring: 'Ring doorbell & cameras',
  life360: 'Life360',
  cast: 'Google Cast',
  braviatv: 'Bravia TV',
  dlna_dmr: 'TV (DLNA)',
  upnp: 'Router & mesh',
  met: 'Weather',
  sun: 'Sun',
  backup: 'HA backups',
  hacs: 'HACS',
  shopping_list: 'Shopping list',
  google_translate: 'Text-to-speech',
};

/**
 * Entities whose `unavailable` is their normal resting state. An Alexa
 * alarm/timer/reminder sensor reads `unavailable` whenever nothing is set,
 * which on a quiet day is 36 of the integration's 151 entities.
 */
export function unavailableIsNormal(entityId: string): boolean {
  return /^sensor\..+_next_(alarm|timer|reminder)$/.test(entityId);
}

const LOADED = 'loaded';

export function verdictFor(state: string, disabled: boolean, entities: number, unavailable: number): Verdict {
  if (disabled) return 'off';
  if (state !== LOADED) return 'down';
  if (entities > 0 && unavailable === entities) return 'down';
  if (entities > 0 && unavailable / entities >= 0.25) return 'degraded';
  if (unavailable > 0) return 'watch';
  return 'ok';
}

const SEVERITY: Record<Verdict, number> = { down: 0, degraded: 1, watch: 2, ok: 3, off: 4 };

function isDisabled(disabledBy: string): boolean {
  return !!disabledBy && disabledBy !== 'None';
}

/** An entry title that is an account e-mail or a repeat of the domain adds nothing. */
function usefulTitle(title: string, label: string): string | null {
  const t = title.trim();
  if (!t || t.includes('@') || t.toLowerCase() === label.toLowerCase()) return null;
  return t;
}

export function summariseDevices(payload: DevicesPayload): DevicesSummary {
  const byEntry = new Map<string, EntityRow[]>();
  for (const r of payload.rows ?? []) {
    if (!Array.isArray(r) || typeof r[0] !== 'string') continue;
    const list = byEntry.get(r[0]) ?? [];
    list.push(r);
    byEntry.set(r[0], list);
  }

  const integrations: IntegrationHealth[] = Object.entries(payload.entries ?? {}).map(([id, meta]) => {
    const [domain, title, state, disabledBy] = meta;
    const rows = byEntry.get(id) ?? [];
    const counted = rows.filter((r) => !unavailableIsNormal(r[1]));
    const down = counted.filter((r) => r[2] === 'unavailable');
    const label = LABEL[domain] ?? domain.replace(/_/g, ' ');
    const last = rows.map((r) => r[3]).filter(Boolean).sort().at(-1) ?? null;
    return {
      id,
      domain,
      label,
      title: usefulTitle(title, label),
      state,
      verdict: verdictFor(state, isDisabled(disabledBy), counted.length, down.length),
      entities: counted.length,
      unavailable: down.length,
      unavailableNames: down.slice(0, 6).map((r) => r[6] || r[1]),
      lastChangeAt: last,
    };
  });
  integrations.sort((a, b) => SEVERITY[a.verdict] - SEVERITY[b.verdict] || a.label.localeCompare(b.label));

  const batteries: BatteryReading[] = [];
  for (const r of payload.rows ?? []) {
    const [entryId, entityId, state, , deviceClass, attrLevel, name] = r;
    const raw = attrLevel ?? (deviceClass === 'battery' ? state : null);
    const level = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(level)) continue;
    const domain = payload.entries?.[entryId]?.[0] ?? '';
    const personal =
      PERSONAL_DOMAINS.has(domain) || entityId.startsWith('device_tracker.') || entityId.startsWith('person.');
    batteries.push({ entityId, name: name || entityId, level: Math.round(level), personal });
  }
  batteries.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  const counts: Record<Verdict, number> = { down: 0, degraded: 0, watch: 0, ok: 0, off: 0 };
  for (const i of integrations) counts[i.verdict]++;
  return {
    integrations,
    batteries,
    counts,
    entities: integrations.reduce((n, i) => n + i.entities, 0),
    unavailable: integrations.reduce((n, i) => n + i.unavailable, 0),
  };
}

/**
 * The template that produces a `DevicesPayload` in one call. Entities with no
 * config entry (YAML helpers, `zone.*`, `person.*`) are left out: they have no
 * integration to be healthy or not.
 */
export const DEVICES_TEMPLATE = `{% set ns = namespace(e={}, rows=[]) %}{% for s in states %}{% set c = config_entry_id(s.entity_id) %}{% if c %}{% set ns.rows = ns.rows + [[c, s.entity_id, s.state, s.last_changed.isoformat(), s.attributes.get('device_class'), s.attributes.get('battery_level'), s.name]] %}{% if c not in ns.e %}{% set ns.e = dict(ns.e, **{c: [config_entry_attr(c, 'domain'), config_entry_attr(c, 'title'), config_entry_attr(c, 'state') | string, config_entry_attr(c, 'disabled_by') | string]}) %}{% endif %}{% endif %}{% endfor %}{{ {'entries': ns.e, 'rows': ns.rows} | tojson }}`;
