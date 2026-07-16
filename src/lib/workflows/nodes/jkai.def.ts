import type { NodeDefinition } from '../types';

export const jkaiDef: NodeDefinition = {
  type: 'jkai',
  label: 'JKAI',
  category: 'integration',
  description: 'Manage JKAI autonomous builds: start, check status, list, and control.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'start | status | list | control' },
      prompt: { type: 'string', description: 'Build prompt for start. Supports templates.' },
      title: { type: 'string', description: 'Optional build title. Supports templates.' },
      buildId: { type: 'string', description: 'Build ID for status/control. Supports templates.' },
      action: { type: 'string', description: 'Control action (pause | resume | stop | publish)' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'list' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation', label: 'Action', type: 'dropdown',
      description: 'What to do with JKAI autonomous builds',
      options: [
        { value: 'start', label: 'Start Build' },
        { value: 'status', label: 'Check Status' },
        { value: 'list', label: 'List Builds' },
        { value: 'control', label: 'Control Build' },
      ],
    },
    {
      key: 'prompt', label: 'Prompt', type: 'template-textarea',
      placeholder: 'Build a landing page with...',
      description: 'Description of what you want JKAI to build.',
      visibleWhen: { key: 'operation', equals: 'start' },
    },
    {
      key: 'title', label: 'Title', type: 'template-textarea',
      placeholder: 'My Build',
      description: 'Optional friendly name for this build.',
      visibleWhen: { key: 'operation', equals: 'start' },
    },
    {
      key: 'buildId', label: 'Build ID', type: 'template-textarea',
      placeholder: '{{input.buildId}}',
      description: 'ID of the build to check or control.',
      visibleWhen: { key: 'operation', in: ['status', 'control'] },
    },
    {
      key: 'action', label: 'Control Action', type: 'dropdown',
      description: 'What to do with the build',
      options: [
        { value: 'pause', label: 'Pause' },
        { value: 'resume', label: 'Resume' },
        { value: 'stop', label: 'Stop' },
        { value: 'publish', label: 'Publish' },
      ],
      visibleWhen: { key: 'operation', equals: 'control' },
    },
  ],
  llmDescription: `Manage JKAI autonomous code builds in a Docker sandbox. Supports four operations:

1. **start** — Start a new build with a prompt (and optional title)
2. **status** — Full build overview + iterations for a build by ID
3. **list** — List all builds (most recent first, up to 50)
4. **control** — Control a build (pause, resume, stop, publish)

IMPORTANT: Downstream nodes access this node's result as \`input.success\`, \`input.data\`, \`input.error\` (the upstream output is merged directly into the downstream input).

All text fields support \`{{input.field}}\` template interpolation.`,
  llmExamples: [
    { operation: 'list' },
    { operation: 'start', prompt: 'Build a React dashboard with charts', title: 'Dashboard Build' },
    { operation: 'status', buildId: '{{input.data.id}}' },
    { operation: 'control', buildId: '{{input.data.id}}', action: 'stop' },
  ],
};
