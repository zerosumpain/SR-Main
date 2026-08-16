import { register } from '../registry-internal';
import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';
import { loadRegistryMap } from '$lib/workflows/nodes/home-assistant';
import { resolveEntityId, searchEntities, DEFAULT_LIMIT, MAX_LIMIT } from '$lib/workflows/homeassistant/entity-search';

register({
  name: 'ha_query_state',
  description: 'Get the current state and attributes of a Home Assistant entity',
  parameters: {
    type: 'object',
    properties: {
      entity_id: { type: 'string', description: 'Entity ID, e.g. light.living_room_ceiling. `entityId` is accepted too. Use ha_find first if you do not already know the exact id.' },
    },
    required: ['entity_id'],
  },
  category: 'Home Assistant',
  toolset: 'home',
  handler: async (args) => {
    // A missing id used to reach Home Assistant as `/api/states/undefined` and
    // come back "404 Not Found" — which reads as "no such entity" and sends
    // the caller guessing at ids. Say what actually went wrong.
    const entityId = resolveEntityId(args);
    if (!entityId) return { success: false, error: 'entity_id is required. Call ha_find to look one up by name, room or keyword.' };
    const service = getHomeAssistantService();
    return await service.queryState(entityId);
  },
});

register({
  name: 'ha_call_service',
  description:
    'Call a Home Assistant service to control a device (turn on/off lights, set temperature, play media, etc.)',
  parameters: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'Service domain, e.g. light, climate, media_player, switch',
      },
      service: {
        type: 'string',
        description: 'Service name, e.g. turn_on, turn_off, toggle, set_temperature',
      },
      entity_id: { type: 'string', description: 'Target entity ID (`entityId` is accepted too)' },
      data: {
        type: 'object',
        description:
          'Additional service data, e.g. { "brightness": 128 } or { "temperature": 20 }',
      },
    },
    required: ['domain', 'service'],
  },
  category: 'Home Assistant',
  toolset: 'home',
  handler: async (args) => {
    const service = getHomeAssistantService();
    return await service.callService(
      args.domain as string,
      args.service as string,
      resolveEntityId(args) || undefined,
      args.data as Record<string, unknown> | undefined,
    );
  },
});

register({
  name: 'ha_fire_event',
  description: 'Fire a Home Assistant event to trigger automations',
  parameters: {
    type: 'object',
    properties: {
      event_type: { type: 'string', description: 'Event type name' },
      data: { type: 'object', description: 'Event data payload' },
    },
    required: ['event_type'],
  },
  category: 'Home Assistant',
  toolset: 'home',
  handler: async (args) => {
    const service = getHomeAssistantService();
    return await service.fireEvent(
      args.event_type as string,
      args.data as Record<string, unknown> | undefined,
    );
  },
});

register({
  name: 'ha_get_history',
  description: 'Get historical state data for an entity over a time period',
  parameters: {
    type: 'object',
    properties: {
      entity_id: { type: 'string', description: 'Entity ID to get history for (`entityId` is accepted too)' },
      start: { type: 'string', description: 'ISO 8601 start time (default: 24h ago)' },
      end: { type: 'string', description: 'ISO 8601 end time (default: now)' },
    },
    required: ['entity_id'],
  },
  category: 'Home Assistant',
  toolset: 'home',
  handler: async (args) => {
    const service = getHomeAssistantService();
    return await service.getHistory(
      resolveEntityId(args),
      args.start as string | undefined,
      args.end as string | undefined,
    );
  },
});

register({
  name: 'ha_render_template',
  description: 'Evaluate a Home Assistant Jinja2 template server-side',
  parameters: {
    type: 'object',
    properties: {
      template: { type: 'string', description: 'Jinja2 template string' },
    },
    required: ['template'],
  },
  category: 'Home Assistant',
  toolset: 'home',
  handler: async (args) => {
    const service = getHomeAssistantService();
    return await service.renderTemplate(args.template as string);
  },
});

/**
 * Find entities — the one call that replaces the Jinja sweep.
 *
 * Over 30 days this domain cost 152 calls, and the shape was always the same:
 * six or seven `ha_render_template` calls hand-writing
 * `{{ states | map(...) | select('search', '<word>') | list }}`, one keyword at
 * a time, then one `ha_query_state` per candidate id. The house has ~415
 * entities and `/api/states` returns all of them in a single request, so none
 * of that ever needed more than one round trip.
 *
 * States come live; area and friendly names come from the cached registry that
 * `/api/states` does not carry. Attributes are opt-in for the same reason the
 * calendar's raw ICS is: 415 entities' attributes is a payload nobody reads.
 */
register({
  name: 'ha_find',
  description:
    'Find Home Assistant entities by keyword, domain, area or current state — and get their live states in the SAME call. ' +
    'Use this INSTEAD of writing a Jinja template to search for entities, and instead of calling ha_query_state repeatedly to ' +
    'guess at entity ids. `query` matches the entity id, the friendly name and the room, and every word must match, so ' +
    '"garage door" narrows rather than widens. Combine with `domain` ("binary_sensor", "lock", "light") and `state` ("on") to ' +
    'answer things like "is anything open" in one go. The reply also carries a `domains` count and the `areas` present across ' +
    'ALL matches, so you can see what kinds of thing exist without asking again. Attributes are omitted unless you ask for ' +
    'them. If a result is `truncated`, narrow the query rather than paging.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words to match against entity id, friendly name and area. All words must match.' },
      domain: { type: ['string', 'array'], items: { type: 'string' }, description: 'Restrict to one or more domains, e.g. "binary_sensor", "lock", "light", "person".' },
      area: { type: ['string', 'array'], items: { type: 'string' }, description: 'Restrict to one or more areas (rooms) by name.' },
      state: { type: 'string', description: 'Only entities currently in this state, e.g. "on", "open", "unavailable".' },
      limit: { type: 'number', description: `Rows to return. Default ${DEFAULT_LIMIT}, maximum ${MAX_LIMIT}.` },
      includeAttributes: { type: 'boolean', description: 'Include every attribute per entity. Off by default — it is a very large payload.' },
    },
    required: [],
  },
  category: 'Home Assistant',
  toolset: 'home',
  handler: async (args) => {
    const service = getHomeAssistantService();
    const all = await service.queryAllStates();
    if (!all.success) return { success: false, error: all.error ?? 'Unable to read Home Assistant states.' };
    // The registry is enrichment, not a dependency — a stale or missing cache
    // must not lose entities, because the house still has doors while a sync
    // is pending.
    const registry = await loadRegistryMap().catch(() => new Map());
    return { success: true, data: searchEntities(all.data, registry, args) };
  },
});
