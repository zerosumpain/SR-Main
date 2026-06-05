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
      entityId: { type: 'string', description: 'Target entity ID (single). Supports {{input.field}} templates. Used by call_service and as a fallback for query_state/get_history.' },
      entityIds: { type: 'array', items: { type: 'string' }, description: 'Selected entity IDs (multi-select tree) for query_state/get_history.' },
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
  defaultConfig: { operation: 'query_state', entityId: '', entityIds: [] },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  summarize: (config) => {
    const op = String(config.operation ?? 'query_state');
    const ids = Array.isArray(config.entityIds) ? config.entityIds.filter((x) => typeof x === 'string' && x) : [];
    const scalar = String(config.entityId ?? '').trim();
    const count = ids.length || (scalar ? 1 : 0);
    let line: string;
    if (op === 'call_service') {
      const svc = String(config.service ?? '').trim();
      line = svc ? `Call ${svc}${scalar ? ` on ${scalar}` : ''}` : 'Call a Home Assistant service';
    } else if (op === 'fire_event') {
      line = `Fire event ${String(config.eventType ?? '').trim() || '…'}`;
    } else if (op === 'render_template') {
      line = 'Render a Home Assistant template';
    } else {
      const verb = op === 'get_history' ? 'Read history for' : 'Read';
      line = count ? `${verb} ${count} entit${count === 1 ? 'y' : 'ies'}` : `${verb} Home Assistant entities (none selected)`;
    }
    return { line, preview: { kind: 'other', details: { Operation: op, Entities: String(count) } } };
  },
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

IMPORTANT: query_state/get_history support MULTIPLE entities — set \`entityIds\` (array) to read several at once. Their output is \`input.entities\` — an array of { entity_id, domain, area_name, state, attributes } — address values downstream as \`input.entities.0.state\`, \`input.entities.0.area_name\`, etc. call_service/fire_event/render_template keep \`input.success\`/\`input.data\`/\`input.error\`.

All text fields support \`{{input.field}}\` template interpolation.`,
  llmExamples: [
    { operation: 'query_state', entityIds: ['sensor.living_room_temperature', 'sensor.living_room_humidity'] },
    { operation: 'call_service', entityId: 'light.kitchen', domain: 'light', service: 'turn_off' },
    { operation: 'call_service', entityId: 'climate.living_room', domain: 'climate', service: 'set_temperature', serviceData: '{"temperature": 20}' },
    { operation: 'get_history', entityId: 'sensor.temperature', historyStart: '{{input.start_time}}' },
  ],
};
