import type { HAEntity } from './types';

export const HA_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'ha_query_state',
      description: 'Get the current state and attributes of a Home Assistant entity',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string', description: 'Entity ID, e.g. light.living_room_ceiling' },
        },
        required: ['entity_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'ha_call_service',
      description: 'Call a Home Assistant service to control a device (turn on/off lights, set temperature, play media, etc.)',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Service domain, e.g. light, climate, media_player, switch' },
          service: { type: 'string', description: 'Service name, e.g. turn_on, turn_off, toggle, set_temperature' },
          entity_id: { type: 'string', description: 'Target entity ID' },
          data: { type: 'object', description: 'Additional service data, e.g. { "brightness": 128 } or { "temperature": 20 }' },
        },
        required: ['domain', 'service'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
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
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'ha_get_history',
      description: 'Get historical state data for an entity over a time period',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string', description: 'Entity ID to get history for' },
          start: { type: 'string', description: 'ISO 8601 start time (default: 24h ago)' },
          end: { type: 'string', description: 'ISO 8601 end time (default: now)' },
        },
        required: ['entity_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'ha_render_template',
      description: 'Evaluate a Home Assistant Jinja2 template server-side',
      parameters: {
        type: 'object',
        properties: {
          template: { type: 'string', description: 'Jinja2 template string' },
        },
        required: ['template'],
      },
    },
  },
];

export function buildEntitySummary(entities: HAEntity[]): string {
  const byArea = new Map<string, HAEntity[]>();
  for (const e of entities) {
    const area = e.area_name || 'Ungrouped';
    const list = byArea.get(area) || [];
    list.push(e);
    byArea.set(area, list);
  }

  const lines: string[] = [];
  for (const [area, areaEntities] of byArea) {
    const byDomain = new Map<string, string[]>();
    for (const e of areaEntities) {
      const list = byDomain.get(e.domain) || [];
      list.push(e.friendly_name);
      byDomain.set(e.domain, list);
    }

    const parts = Array.from(byDomain.entries())
      .map(([domain, names]) => {
        if (names.length <= 3) return `${names.join(', ')} (${domain})`;
        return `${names.length} ${domain}s`;
      })
      .join(', ');

    lines.push(`${area}: ${parts}`);
  }

  return lines.join('\n');
}

export function buildHASystemPromptSection(entities: HAEntity[]): string {
  if (entities.length === 0) return '';
  const summary = buildEntitySummary(entities);
  return `\n\n--- Home Assistant Smart Home ---\nYou can control the smart home using ha_* functions. Available areas and devices:\n\n${summary}\n\nUse exact entity_id values when calling functions (e.g. "light.living_room_ceiling", not "living room ceiling light").`;
}
