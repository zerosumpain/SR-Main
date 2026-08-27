// src/lib/daydream/signals/ha.ts
//
// Turning the house into signals.
//
// One `/api/states` call returns all 415 entities with their attributes. Of
// those, 16 currently carry a numeric state, 28 are binary sensors, and there
// are 427 numeric ATTRIBUTES spread across 263 entities — which is where the
// interesting readings actually live. `weather.forecast_home` keeps humidity,
// pressure, cloud cover, dew point, UV index and wind in attributes and none in
// its state; a climate entity keeps `current_temperature` there too. Reading
// states alone would miss nearly all of it, which is exactly the brief.
//
// Nothing here has a list of entities in it. That is the design: on the day the
// Tado comes back — `climate.downstairs_hallway` is `unavailable` with
// `restored: true` as this is written, along with its whole
// `binary_sensor.downstairs_hallway_*` family — it starts producing signals
// because it started answering, not because anyone edited this file.

import { registerSignals, signalKey, type Reading, type SignalSpec } from './registry';

/** One entity as `/api/states` returns it. */
export interface HAState {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
}

/**
 * Attributes that are numbers but are not measurements.
 *
 * Configuration and protocol noise: a `supported_features` bitmask correlates
 * with nothing, and `min_temp`/`max_temp` are the dial's range rather than the
 * room's temperature. Left in, each becomes a permanent constant series that
 * costs a test in every sweep and can never produce a finding — the sweep's own
 * argument for keeping its metric list explicit, applied one level down.
 */
const IGNORED_ATTRIBUTES = new Set([
  'supported_features',
  'min_temp',
  'max_temp',
  'min_color_temp_kelvin',
  'max_color_temp_kelvin',
  'min_mireds',
  'max_mireds',
  'target_temp_step',
  'min',
  'max',
  'step',
  'friendly_name',
  'editable',
  'attribution',
  'latitude',
  'longitude',
  'gps_accuracy',
  'elevation',
]);

/**
 * Domains whose numbers are volume knobs and scene indices rather than
 * observations about the world. `scene`, `notify` and `update` carry no state
 * worth a series; `number.*` here is speaker volume.
 */
const IGNORED_DOMAINS = new Set(['scene', 'notify', 'update', 'automation', 'script', 'number']);

/** HA's own words for "I could not read this". Never a zero. */
const NOT_A_READING = new Set(['unavailable', 'unknown', 'none', '']);

function isPlainNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Attribute names that are identifiers rather than quantities.
 *
 * The first live run registered `camera.front_door_live_view#last_video_id`
 * with a value of 7.67e18. It is a number, it changes daily, and it correlates
 * with nothing — which is precisely the failure the sweep's hand-written metric
 * list was written to prevent ("an automatic sweep would silently start testing
 * identifiers"). Removing the list means catching this here instead.
 */
const IDENTIFIER_ATTRIBUTE = /(^|_)(id|ids|uuid|guid|serial|serial_number|mac|token|hash|revision|sequence)$/;

/** No genuine household reading is this large. A number past 2^53-ish is an
 *  identifier or a timestamp in nanoseconds, never a temperature. */
const ABSURD_MAGNITUDE = 1e12;

/** HA reports booleans as on/off, open/closed, home/not_home. A duty cycle over
 *  a day is a genuinely useful series, so they are kept as 0/1. */
function asBoolean(state: string): number | null {
  const s = state.toLowerCase();
  if (['on', 'open', 'home', 'detected', 'true', 'locked'].includes(s)) return 1;
  if (['off', 'closed', 'not_home', 'clear', 'false', 'unlocked'].includes(s)) return 0;
  return null;
}

function numericState(state: string): number | null {
  if (NOT_A_READING.has(state.toLowerCase())) return null;
  const n = Number(state);
  return Number.isFinite(n) ? n : null;
}

function pretty(entityId: string, attrs: Record<string, unknown>, attribute?: string): string {
  const base = typeof attrs.friendly_name === 'string' ? attrs.friendly_name : entityId;
  return attribute ? `${base} — ${attribute.replace(/_/g, ' ')}` : base;
}

export interface HarvestResult {
  specs: SignalSpec[];
  readings: Reading[];
  /** Entities that answered `unavailable` — reported, never treated as zero. */
  unavailable: number;
}

/**
 * Read the whole house into signals and readings.
 *
 * PURE — takes the states, returns what to register and what to record — so the
 * decision about what counts as a signal is unit-testable without a house.
 */
export function harvest(states: HAState[]): HarvestResult {
  const specs: SignalSpec[] = [];
  const readings: Reading[] = [];
  let unavailable = 0;

  for (const e of states) {
    const domain = e.entity_id.split('.')[0];
    if (IGNORED_DOMAINS.has(domain)) continue;

    const attrs = e.attributes ?? {};
    const state = String(e.state ?? '');

    if (NOT_A_READING.has(state.toLowerCase())) unavailable++;

    // ── the entity's own state ────────────────────────────────────────────
    const asNum = numericState(state);
    const asBool = asNum == null ? asBoolean(state) : null;
    if (asNum != null || asBool != null) {
      const key = signalKey('ha', e.entity_id);
      specs.push({
        key,
        source: 'ha',
        label: pretty(e.entity_id, attrs),
        unit: typeof attrs.unit_of_measurement === 'string' ? attrs.unit_of_measurement : null,
        valueKind: asNum != null ? 'numeric' : 'boolean',
        deviceClass: typeof attrs.device_class === 'string' ? attrs.device_class : null,
      });
      readings.push({ key, value: asNum ?? (asBool as number) });
    }

    // ── and every numeric attribute it carries ────────────────────────────
    // Where the temperature, humidity and pressure actually live.
    for (const [name, value] of Object.entries(attrs)) {
      if (IGNORED_ATTRIBUTES.has(name)) continue;
      if (IDENTIFIER_ATTRIBUTE.test(name)) continue;
      if (!isPlainNumber(value)) continue;
      if (Math.abs(value) >= ABSURD_MAGNITUDE) continue;
      const key = signalKey('ha', `${e.entity_id}#${name}`);
      specs.push({
        key,
        source: 'ha',
        label: pretty(e.entity_id, attrs, name),
        unit: unitForAttribute(name, attrs),
        valueKind: 'numeric',
        deviceClass: null,
      });
      readings.push({ key, value });
    }
  }

  return { specs, readings, unavailable };
}

/** HA puts a companion `*_unit` beside several attributes; use it where it is
 *  there rather than guessing, and say nothing where it is not. */
function unitForAttribute(name: string, attrs: Record<string, unknown>): string | null {
  const companion = attrs[`${name}_unit`];
  if (typeof companion === 'string') return companion;
  if (name === 'temperature' || name === 'dew_point') {
    return typeof attrs.temperature_unit === 'string' ? attrs.temperature_unit : '°C';
  }
  if (name === 'humidity' || name === 'cloud_coverage') return '%';
  if (name === 'pressure') {
    return typeof attrs.pressure_unit === 'string' ? attrs.pressure_unit : 'hPa';
  }
  if (name === 'wind_speed') {
    return typeof attrs.wind_speed_unit === 'string' ? attrs.wind_speed_unit : 'km/h';
  }
  return null;
}

/**
 * Fetch the house and register whatever is new.
 *
 * A failure here is reported, never fatal: Home Assistant is on the home LAN
 * and daydream is not, so an unreachable house is an ordinary Tuesday and must
 * not take a heartbeat action's failure budget with it.
 */
export async function harvestHomeAssistant(): Promise<
  HarvestResult & { ok: boolean; error?: string; entities: number }
> {
  const empty = { specs: [], readings: [], unavailable: 0, entities: 0 };
  try {
    const { getHomeAssistantService } = await import('$lib/workflows/homeassistant/service');
    const service = getHomeAssistantService();
    if (!service.isConfigured()) {
      return { ...empty, ok: false, error: 'home assistant not configured' };
    }
    const res = await service.queryAllStates();
    if (!res.success || !Array.isArray(res.data)) {
      return { ...empty, ok: false, error: res.error ?? 'no states returned' };
    }
    const states = res.data as HAState[];
    const out = harvest(states);
    await registerSignals(out.specs);
    return { ...out, ok: true, entities: states.length };
  } catch (err) {
    return { ...empty, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
