import type { NodeDefinition } from '../types';

export const healthQueryDef: NodeDefinition = {
  type: 'health-query',
  label: 'Health Query',
  category: 'integration',
  description: 'Query health data from Strava, Apple Watch, and other fitness sources.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'stats | readiness | sleep | training_load | timeline' },
      page: { type: 'string', description: 'Page number for timeline (default 1). Supports templates.' },
      limit: { type: 'string', description: 'Items per page for timeline (default 20). Supports templates.' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'stats' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation', label: 'Action', type: 'dropdown',
      description: 'Which health data summary to fetch',
      options: [
        { value: 'stats', label: 'Fitness Stats' },
        { value: 'readiness', label: 'Readiness Score' },
        { value: 'sleep', label: 'Sleep Analysis' },
        { value: 'training_load', label: 'Training Load' },
        { value: 'timeline', label: 'Activity Timeline' },
      ],
    },
    {
      key: 'page', label: 'Page', type: 'number', min: 1,
      description: 'Page number for paginated timeline results.',
      visibleWhen: { key: 'operation', equals: 'timeline' },
    },
    {
      key: 'limit', label: 'Items Per Page', type: 'number', min: 1,
      description: 'How many activities to return per page.',
      visibleWhen: { key: 'operation', equals: 'timeline' },
    },
  ],
  llmDescription: `Query health data from Strava and Apple Watch including fitness stats, readiness scores, sleep analysis, training load, and activity timeline.

1. **stats** — Get current fitness stats summary (HR, steps, active calories, etc.)
2. **readiness** — Get readiness/recovery score based on HRV, sleep, and training load
3. **sleep** — Get sleep analysis data (duration, stages, quality)
4. **training_load** — Get training load and fitness/fatigue metrics
5. **timeline** — Get paginated activity timeline. Supports page/limit params.

IMPORTANT: Downstream nodes access this node's result as \`input.success\`, \`input.data\`, \`input.error\` (the upstream output is merged directly into the downstream input).`,
  llmExamples: [
    { operation: 'readiness' },
    { operation: 'stats' },
    { operation: 'timeline', page: '1', limit: '10' },
  ],
};
