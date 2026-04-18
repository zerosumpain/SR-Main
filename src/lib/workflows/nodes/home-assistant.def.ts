import type { NodeDefinition } from '../types';

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

IMPORTANT: Downstream nodes access this node's result as \`input.success\`, \`input.data\`, \`input.error\` (the upstream output is merged directly into the downstream input).

All text fields support \`{{input.field}}\` template interpolation.`,
  llmExamples: [
    { operation: 'query_state', entityId: 'sensor.living_room_temperature' },
    { operation: 'call_service', entityId: 'light.kitchen', domain: 'light', service: 'turn_off' },
    { operation: 'call_service', entityId: 'climate.living_room', domain: 'climate', service: 'set_temperature', serviceData: '{"temperature": 20}' },
    { operation: 'get_history', entityId: 'sensor.temperature', historyStart: '{{input.start_time}}' },
  ],
};
