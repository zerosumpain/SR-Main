// src/lib/workflows/homeassistant/entity-search.ts
//
// Find Home Assistant entities in ONE call.
//
// Measured over 30 days of live traffic, Home Assistant was the most expensive
// domain in the toolchain: 152 calls across `ha_render_template` (80) and
// `ha_query_state` (72), and 76 of those 80 template calls carried DIFFERENT
// arguments — so it was never redundancy, it was the absence of a way to ask.
//
// What the model was actually doing, verbatim from the traces, is writing a
// search engine in Jinja, one keyword per call:
//
//   {{ states | map(attribute='entity_id') | select('search','lock')   | list }}
//   {{ states | map(attribute='entity_id') | select('search','alarm')  | list }}
//   {{ states | ... select('search','binary_sensor') | select('search','door')   | list }}
//   {{ states | ... select('search','binary_sensor') | select('search','window') | list }}
//   ...seven of these in a row, then one `ha_query_state` per candidate id.
//
// Every one of those is this module's `criteria`. The house has ~415 entities
// and HA's `/api/states` returns all of them in a single request, so the whole
// question is answerable in one round trip — the filtering never needed to be
// pushed into a template at all.
//
// Pure on purpose: no HTTP, no database. The caller supplies the live states
// and the cached registry, which is what makes the ranking and the shaping
// testable against fixtures rather than against a house.

/** One row of HA's `/api/states` response. */
export interface HAStateRow {
  entity_id?: unknown;
  state?: unknown;
  last_changed?: unknown;
  attributes?: Record<string, unknown> | unknown;
}

/** What the cached entity registry knows that `/api/states` does not. */
export interface RegistryMeta {
  area_id: string | null;
  area_name: string | null;
  domain: string;
  friendly_name: string;
}

export interface EntityCriteria {
  query?: unknown;
  domain?: unknown;
  area?: unknown;
  state?: unknown;
  limit?: unknown;
  includeAttributes?: unknown;
}

export interface FoundEntity {
  entity_id: string;
  domain: string;
  friendly_name: string;
  area_name: string | null;
  state: string | null;
  last_changed?: string;
  /** Only when `includeAttributes` was asked for. */
  attributes?: Record<string, unknown>;
  /** The handful worth having on every row — a door sensor is useless without
   *  knowing it is a door, and a reading is useless without its unit. */
  device_class?: string;
  unit?: string;
}

export interface EntitySearchResult {
  entities: FoundEntity[];
  totalCount: number;
  truncated: boolean;
  /** How many matches per domain. This is the question the model asked next,
   *  every time — "what kinds of thing are there" — and answering it here is
   *  what turns a seven-call sweep into one. */
  domains: Record<string, number>;
  /** Areas represented in the matches, for the same reason. */
  areas: string[];
}

/** Rows returned when the caller names no limit. */
export const DEFAULT_LIMIT = 50;
/** Hard ceiling. ~415 entities with attributes is a payload nobody can read. */
export const MAX_LIMIT = 200;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim().toLowerCase());
  const one = text(value).trim().toLowerCase();
  return one ? [one] : [];
}

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A term matches where a WORD STARTS, never mid-word.
 *
 * A plain substring test looks right until you run it: searching "door"
 * matches `sensor.outdoor_temperature`, because "outdoor" contains it. That is
 * precisely the near-miss that makes a result set untrustworthy, and an
 * untrustworthy list is what sends a caller back to guessing at ids.
 *
 * Anchoring to a word start rather than requiring a whole word keeps the
 * useful case: "temp" still finds `outdoor_temperature`, and "kitchen" still
 * finds `light.kitchen_ceiling`. Dots and underscores count as boundaries,
 * because that is how entity ids are built.
 */
export function matchesTerm(haystack: string, term: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escape(term)}`).test(haystack);
}

/**
 * Every term must match — AND, not OR.
 *
 * The traces show the model narrowing with two words at once
 * (`binary_sensor` + `door`), which under OR would return every binary sensor
 * in the house and answer nothing. AND is what makes a second word useful.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const terms = query.toLowerCase().split(/[^a-z0-9_.]+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = haystack.toLowerCase();
  return terms.every((t) => matchesTerm(hay, t));
}

/**
 * Rank so the obvious answer is first.
 *
 * A name match beats an id match, and a whole word beats a prefix. Mid-word
 * hits never get here at all — `matchesTerm` has already excluded
 * `sensor.outdoor_temperature` from a search for "door" — so this decides the
 * order among genuine matches, not whether a near-miss is one.
 */
export function scoreEntity(entity: FoundEntity, query: string): number {
  const terms = query.toLowerCase().split(/[^a-z0-9_.]+/).filter(Boolean);
  if (!terms.length) return 0;
  let score = 0;
  const id = entity.entity_id.toLowerCase();
  const name = entity.friendly_name.toLowerCase();
  for (const t of terms) {
    // A whole word outranks a prefix: searching "door" should put `Front Door`
    // above `Doorbell Battery`, and the name outranks the id because that is
    // what the person actually said.
    const whole = new RegExp(`(^|[^a-z0-9])${escape(t)}([^a-z0-9]|$)`);
    if (whole.test(name)) score += 10;
    else if (matchesTerm(name, t)) score += 4;
    if (whole.test(id)) score += 6;
    else if (matchesTerm(id, t)) score += 2;
  }
  return score;
}

/**
 * Filter, rank and shape. One pass over every state the house reported.
 *
 * `registry` may be empty — the area enrichment is a nicety and its absence
 * must not lose the entity, because the registry cache is refreshed on a sync
 * and a house does not stop having doors while that is stale.
 */
export function searchEntities(
  states: unknown,
  registry: Map<string, RegistryMeta>,
  criteria: EntityCriteria = {},
): EntitySearchResult {
  const rows: HAStateRow[] = Array.isArray(states) ? (states as HAStateRow[]) : [];

  const query = text(criteria.query).trim();
  const domains = toList(criteria.domain);
  const areas = toList(criteria.area);
  const wantedState = text(criteria.state).trim().toLowerCase();
  const includeAttributes = criteria.includeAttributes === true;

  const rawLimit = Number(criteria.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;

  const matched: Array<{ entity: FoundEntity; score: number }> = [];

  for (const row of rows) {
    const entityId = text(row?.entity_id);
    if (!entityId) continue;
    const attributes = (row?.attributes && typeof row.attributes === 'object' ? row.attributes : {}) as Record<string, unknown>;
    const meta = registry.get(entityId);
    const domain = meta?.domain || entityId.split('.')[0] || '';
    const areaName = meta?.area_name ?? null;
    const friendly = text(attributes.friendly_name) || meta?.friendly_name || entityId;
    const state = typeof row?.state === 'string' ? row.state : null;

    if (domains.length && !domains.includes(domain.toLowerCase())) continue;
    if (areas.length && !areas.includes((areaName ?? '').toLowerCase())) continue;
    if (wantedState && (state ?? '').toLowerCase() !== wantedState) continue;
    // The id, the human name and the room are all things a person might say.
    if (query && !matchesQuery(`${entityId} ${friendly} ${areaName ?? ''}`, query)) continue;

    const entity: FoundEntity = {
      entity_id: entityId,
      domain,
      friendly_name: friendly,
      area_name: areaName,
      state,
      ...(typeof row?.last_changed === 'string' ? { last_changed: row.last_changed } : {}),
      ...(typeof attributes.device_class === 'string' ? { device_class: attributes.device_class } : {}),
      ...(typeof attributes.unit_of_measurement === 'string' ? { unit: attributes.unit_of_measurement } : {}),
      ...(includeAttributes ? { attributes } : {}),
    };
    matched.push({ entity, score: query ? scoreEntity(entity, query) : 0 });
  }

  matched.sort((a, b) => b.score - a.score || a.entity.entity_id.localeCompare(b.entity.entity_id));

  // Counted over EVERY match, not just the page returned — otherwise a
  // truncated result reports a domain breakdown of the first 50 rows and
  // quietly implies the house has nothing else.
  const domainCounts: Record<string, number> = {};
  const areaSet = new Set<string>();
  for (const { entity } of matched) {
    domainCounts[entity.domain] = (domainCounts[entity.domain] ?? 0) + 1;
    if (entity.area_name) areaSet.add(entity.area_name);
  }

  return {
    entities: matched.slice(0, limit).map((m) => m.entity),
    totalCount: matched.length,
    truncated: matched.length > limit,
    domains: domainCounts,
    areas: [...areaSet].sort(),
  };
}

/**
 * Accept both spellings of an entity argument.
 *
 * Not a convenience. `ha_query_state` declares `entity_id`, and over 30 days
 * **32 of 72 calls passed `entityId`** — the handler read `undefined`, built
 * `/api/states/undefined`, and Home Assistant answered `404 Not Found`. The
 * model reads that as "the entity does not exist" and guesses another id,
 * which is exactly the `lock.0` / `alarm_control_panel.ha_alarm` spiral in the
 * traces. A 44% failure rate that presents as a wrong fact about the house.
 *
 * The repo already settled this argument elsewhere: `resolveWorkflowId` in
 * `$lib/mcp/server.ts` takes `workflow_id` or `workflowId` for the same
 * reason. Coerce, never reject.
 */
export function resolveEntityId(args: Record<string, unknown>): string {
  for (const key of ['entity_id', 'entityId', 'entity'] as const) {
    const value = args?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}
