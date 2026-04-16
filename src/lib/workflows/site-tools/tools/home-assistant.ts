import { register } from '../registry-internal';
import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';

register({
  name: 'ha_query_state',
  description: 'Get the current state and attributes of a Home Assistant entity',
  parameters: {
    type: 'object',
    properties: {
      entity_id: { type: 'string', description: 'Entity ID, e.g. light.living_room_ceiling' },
    },
    required: ['entity_id'],
  },
  category: 'Home Assistant',
  toolset: 'home',
  handler: async (args) => {
    const service = getHomeAssistantService();
    return await service.queryState(args.entity_id as string);
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
      entity_id: { type: 'string', description: 'Target entity ID' },
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
      args.entity_id as string | undefined,
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
      entity_id: { type: 'string', description: 'Entity ID to get history for' },
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
      args.entity_id as string,
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
