import type { NodeDefinition } from '../types';

export const whoopDef: NodeDefinition = {
  type: 'whoop',
  label: 'Whoop',
  category: 'integration',
  description:
    'Access Whoop health data. Requires Whoop connected in Health settings. Prefer DB-backed ops (get_summary, get_recent, query_recovery) — they are fast and free; *_api ops hit the Whoop API directly.',
  configSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description:
          'get_summary | get_recent | query_recovery | get_cycles | get_recovery | get_sleep | get_workouts',
      },
      days: { type: 'number', description: 'Number of trailing days for get_recent / get_summary' },
      limit: { type: 'number', description: 'Max records to return (default 10)' },
      metric: {
        type: 'string',
        description: 'For query_recovery: hrv | recovery | rhr | sleep_performance | strain',
      },
      start: { type: 'string', description: 'ISO 8601 start date filter (optional)' },
      end: { type: 'string', description: 'ISO 8601 end date filter (optional)' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'get_summary', days: 30, limit: 10 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation',
      label: 'Action',
      type: 'dropdown',
      description: 'What to do',
      options: [
        { value: 'get_summary', label: 'Summary (DB · last N days)' },
        { value: 'get_recent', label: 'Recent days (DB · per-day rows)' },
        { value: 'query_recovery', label: 'Query metric series (DB)' },
        { value: 'get_cycles', label: 'Cycles — API (daily strain)' },
        { value: 'get_recovery', label: 'Recovery Scores — API' },
        { value: 'get_sleep', label: 'Sleep Records — API' },
        { value: 'get_workouts', label: 'Workouts — API' },
      ],
    },
    {
      key: 'days',
      label: 'Days',
      type: 'number',
      min: 1,
      description: 'Trailing window in days. Used by Summary / Recent.',
      visibleWhen: { key: 'operation', in: ['get_summary', 'get_recent'] },
    },
    {
      key: 'metric',
      label: 'Metric',
      type: 'dropdown',
      description: 'Which metric series to return.',
      options: [
        { value: 'hrv', label: 'HRV (ms)' },
        { value: 'recovery', label: 'Recovery score (%)' },
        { value: 'rhr', label: 'Resting heart rate (bpm)' },
        { value: 'sleep_performance', label: 'Sleep performance (%)' },
        { value: 'strain', label: 'Strain (cycle)' },
      ],
      visibleWhen: { key: 'operation', equals: 'query_recovery' },
    },
    {
      key: 'limit',
      label: 'Limit',
      type: 'number',
      min: 1,
      description: 'Maximum number of records to return (API ops).',
      visibleWhen: { key: 'operation', in: ['get_cycles', 'get_recovery', 'get_sleep', 'get_workouts'] },
    },
    {
      key: 'start',
      label: 'Start Date',
      type: 'template-textarea',
      section: 'FILTERS',
      placeholder: '2026-01-01T00:00:00Z',
      description: 'ISO 8601 start date filter (optional).',
      advancedOnly: true,
    },
    {
      key: 'end',
      label: 'End Date',
      type: 'template-textarea',
      placeholder: '2026-04-18T00:00:00Z',
      description: 'ISO 8601 end date filter (optional).',
      advancedOnly: true,
    },
  ],
  llmDescription: `Read Whoop health data (requires Whoop connected in Health settings). Prefer the DB-backed ops — they're fast and free: \`get_summary\` (aggregates over the last N days), \`get_recent\` (per-day rows), \`query_recovery\` (a single metric series: hrv | recovery | rhr | sleep_performance | strain). The \`get_*\` API ops (get_cycles/get_recovery/get_sleep/get_workouts) hit the Whoop API directly and are rate-limited. Read-only.`,
  llmExamples: [
    { operation: 'get_summary', days: 7 },
    { operation: 'query_recovery', metric: 'hrv' },
  ],
};
