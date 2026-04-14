import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { getHomeAssistantService } from '../homeassistant/service';
import type { HAOperation } from '../homeassistant/types';

export const homeAssistantExecutor: NodeExecutor = {
  type: 'home-assistant',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = config.operation as HAOperation | undefined;
    if (!operation) {
      return { output: { success: false, error: 'No operation configured' } };
    }

    const service = getHomeAssistantService();
    const entityId = interpolateTemplate((config.entityId as string) || '', input);

    switch (operation) {
      case 'query_state': {
        if (!entityId) return { output: { success: false, error: 'No entity_id configured' } };
        const result = await service.queryState(entityId);
        return { output: result };
      }

      case 'call_service': {
        const domain = interpolateTemplate((config.domain as string) || '', input) || entityId.split('.')[0];
        const svc = interpolateTemplate((config.service as string) || '', input);
        if (!domain || !svc) return { output: { success: false, error: 'domain and service are required' } };
        let serviceData: Record<string, unknown> | undefined;
        const rawData = interpolateTemplate((config.serviceData as string) || '', input);
        if (rawData) {
          try { serviceData = JSON.parse(rawData); } catch { serviceData = undefined; }
        }
        const result = await service.callService(domain, svc, entityId || undefined, serviceData);
        return { output: result };
      }

      case 'fire_event': {
        const eventType = interpolateTemplate((config.eventType as string) || '', input);
        if (!eventType) return { output: { success: false, error: 'No event_type configured' } };
        let eventData: Record<string, unknown> | undefined;
        const rawEvent = interpolateTemplate((config.eventData as string) || '', input);
        if (rawEvent) {
          try { eventData = JSON.parse(rawEvent); } catch { eventData = undefined; }
        }
        const result = await service.fireEvent(eventType, eventData);
        return { output: result };
      }

      case 'get_history': {
        if (!entityId) return { output: { success: false, error: 'No entity_id configured' } };
        const start = interpolateTemplate((config.historyStart as string) || '', input) || undefined;
        const end = interpolateTemplate((config.historyEnd as string) || '', input) || undefined;
        const result = await service.getHistory(entityId, start, end);
        return { output: result };
      }

      case 'render_template': {
        const template = interpolateTemplate((config.template as string) || '', input);
        if (!template) return { output: { success: false, error: 'No template configured' } };
        const result = await service.renderTemplate(template);
        return { output: result };
      }

      default:
        return { output: { success: false, error: `Unknown operation: ${operation}` } };
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation in config fields' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'object' },
        error: { type: 'string' },
      },
    };
  },
};

export const homeAssistantDef: NodeDefinition = {
  type: 'home-assistant',
  label: 'Home Assistant',
  category: 'integration',
  description: 'Control Home Assistant: query state, call services, fire events, get history, render templates.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'query_state | call_service | fire_event | get_history | render_template' },
      entityId: { type: 'string', description: 'Target entity ID. Supports {{input.field}} templates.' },
      domain: { type: 'string', description: 'Service domain (auto-derived from entityId if not set)' },
      service: { type: 'string', description: 'Service name (e.g. turn_on, turn_off, toggle, set_temperature)' },
      serviceData: { type: 'string', description: 'JSON service data. Supports templates.' },
      eventType: { type: 'string', description: 'Event type to fire' },
      eventData: { type: 'string', description: 'JSON event data. Supports templates.' },
      historyStart: { type: 'string', description: 'ISO 8601 start time for history' },
      historyEnd: { type: 'string', description: 'ISO 8601 end time for history' },
      template: { type: 'string', description: 'Jinja2 template to render' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'query_state', entityId: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation', label: 'Operation', type: 'dropdown',
      options: [
        { value: 'query_state', label: 'Query State' },
        { value: 'call_service', label: 'Call Service' },
        { value: 'fire_event', label: 'Fire Event' },
        { value: 'get_history', label: 'Get History' },
        { value: 'render_template', label: 'Render Template' },
      ],
    },
    { key: 'entityId', label: 'Entity ID', type: 'template-textarea', placeholder: 'light.living_room_ceiling' },
    { key: 'domain', label: 'Domain', type: 'text', placeholder: 'light', advancedOnly: true },
    { key: 'service', label: 'Service', type: 'text', placeholder: 'turn_on' },
    { key: 'serviceData', label: 'Service Data (JSON)', type: 'textarea', placeholder: '{"brightness": 128}', advancedOnly: true },
    { key: 'eventType', label: 'Event Type', type: 'text', placeholder: 'custom_event', advancedOnly: true },
    { key: 'eventData', label: 'Event Data (JSON)', type: 'textarea', advancedOnly: true },
    { key: 'historyStart', label: 'History Start', type: 'template-textarea', placeholder: '2026-04-14T00:00:00Z', advancedOnly: true },
    { key: 'historyEnd', label: 'History End', type: 'template-textarea', advancedOnly: true },
    { key: 'template', label: 'Template (Jinja2)', type: 'code', placeholder: '{{ states("light.living_room") }}', advancedOnly: true },
  ],
  llmDescription: `Control Home Assistant smart home devices. Supports five operations:

1. **query_state** — Get current state of an entity. Output: { state, attributes, last_changed }
2. **call_service** — Control a device (turn_on, turn_off, set_temperature, etc.). Specify domain, service, and optionally entity_id + serviceData.
3. **fire_event** — Fire a Home Assistant event to trigger automations.
4. **get_history** — Get historical state data for an entity over a time period.
5. **render_template** — Evaluate a Jinja2 template server-side.

IMPORTANT: Output is wrapped in \`output\`. Downstream nodes access \`input.output.success\`, \`input.output.data\`, \`input.output.error\`.

All text fields support \`{{input.field}}\` template interpolation.`,
  llmExamples: [
    { operation: 'query_state', entityId: 'sensor.living_room_temperature' },
    { operation: 'call_service', entityId: 'light.kitchen', domain: 'light', service: 'turn_off' },
    { operation: 'call_service', entityId: 'climate.living_room', domain: 'climate', service: 'set_temperature', serviceData: '{"temperature": 20}' },
    { operation: 'get_history', entityId: 'sensor.temperature', historyStart: '{{input.output.start_time}}' },
  ],
};
