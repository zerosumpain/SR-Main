import type { NodeDefinition } from '../types';

export const stravaDef: NodeDefinition = {
  type: 'strava',
  label: 'Strava',
  category: 'integration',
  description: 'Access Strava activity data. Requires Strava connected in Health settings.',
  configSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'list_activities | get_activity | get_athlete_stats',
      },
      page: { type: 'number', description: 'Page number for list_activities (default 1)' },
      perPage: { type: 'number', description: 'Results per page for list_activities (default 30, max 200)' },
      activityId: { type: 'string', description: 'Activity ID for get_activity' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'list_activities', page: 1, perPage: 30 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation', label: 'Action', type: 'dropdown',
      description: 'What to fetch from Strava',
      options: [
        { value: 'list_activities', label: 'List Activities' },
        { value: 'get_activity', label: 'Get Single Activity' },
        { value: 'get_athlete_stats', label: 'Get Athlete Stats' },
      ],
    },
    {
      key: 'activityId', label: 'Activity ID', type: 'text',
      placeholder: '1234567890',
      description: 'ID of the Strava activity to fetch.',
      visibleWhen: { key: 'operation', equals: 'get_activity' },
    },
    {
      key: 'page', label: 'Page', type: 'number', min: 1,
      description: 'Page number of results (1 = first page).',
      visibleWhen: { key: 'operation', equals: 'list_activities' },
    },
    {
      key: 'perPage', label: 'Results Per Page', type: 'number', min: 1, max: 200,
      description: 'How many activities to return per page (max 200).',
      visibleWhen: { key: 'operation', equals: 'list_activities' },
    },
  ],
};
