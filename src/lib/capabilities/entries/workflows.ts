import type { CapabilityEntry } from '../types';

// The canvas: SR-Workflows runs these tools; Main serves them on the catalogue.
// One row per registered toolset; `manifest.test.ts` keeps rows and registry in step.

export const WORKFLOWS_ENTRIES: CapabilityEntry[] = [
  {
    id: 'workflows',
    title: 'Workflows',
    blurb: 'Workflow automation — create, inspect, edit nodes/edges/schedules, and amend an existing canvas in one atomic, audited change (workflow_amend)',
    app: 'workflows',
    repo: 'SR-Workflows',
    status: 'live',
    toolsets: ['workflows'],
    tools: ['workflow_build_from_spec', 'workflow_list', 'workflow_delete', 'workflow_inspect', 'workflow_get_run', 'workflow_get_generation_log', 'workflow_update_metadata', 'workflow_update_node', 'workflow_add_node', 'workflow_list_node_types', 'workflow_describe_node', 'workflow_remove_node', 'workflow_add_edge', 'workflow_remove_edge', 'workflow_update_edge', 'workflow_amend', 'workflow_add_schedule', 'workflow_update_schedule', 'workflow_remove_schedule', 'workflow_run', 'workflow_subscribe', 'workflow_unsubscribe', 'workflow_clear_data_store', 'workflow_lint', 'workflow_generate', 'node_call'],
    host: 'workflows',
    keywords: [String.raw`workflow|automat|schedule|trigger|cron`],
    pages: ['/jkai/canvas'],
    memberSafe: false,
  },
];
