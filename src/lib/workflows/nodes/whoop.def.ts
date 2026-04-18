import type { NodeDefinition } from '../types';

export const whoopDef: NodeDefinition = {
  type: 'whoop',
  label: 'Whoop',
  category: 'integration',
  description: 'Access Whoop health data. Requires Whoop connected in Health settings.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'get_cycles | get_recovery | get_sleep | get_workouts' },
      limit: { type: 'number', description: 'Max records to return (default 10)' },
      start: { type: 'string', description: 'ISO 8601 start date filter (optional)' },
      end: { type: 'string', description: 'ISO 8601 end date filter (optional)' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'get_cycles', limit: 10 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation', label: 'Action', type: 'dropdown',
      description: 'What type of Whoop data to fetch',
      options: [
        { value: 'get_cycles', label: 'Cycles (daily strain)' },
        { value: 'get_recovery', label: 'Recovery Scores' },
        { value: 'get_sleep', label: 'Sleep Records' },
        { value: 'get_workouts', label: 'Workouts' },
      ],
    },
    {
      key: 'limit', label: 'Limit', type: 'number', min: 1,
      description: 'Maximum number of records to return.',
    },
    {
      key: 'start', label: 'Start Date', type: 'template-textarea',
      section: 'FILTERS',
      placeholder: '2026-01-01T00:00:00Z',
      description: 'ISO 8601 start date filter (optional).',
      advancedOnly: true,
    },
    {
      key: 'end', label: 'End Date', type: 'template-textarea',
      placeholder: '2026-04-18T00:00:00Z',
      description: 'ISO 8601 end date filter (optional).',
      advancedOnly: true,
    },
  ],
};
