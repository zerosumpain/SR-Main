import type { NodeDefinition } from '../types';

export const deepDiveDef: NodeDefinition = {
  type: 'deep-dive',
  label: 'Deep Dive (legacy)',
  category: 'integration',
  hidden: true,
  description: 'Legacy multi-mode node. Replaced by `deep-dive-start`, `deep-dive-status`, `deep-dive-report`, `deep-dive-list`, `deep-dive-control`. Existing canvases keep running.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'start | status | list | report | control' },
      topic: { type: 'string', description: 'Research topic. Supports templates.' },
      goals: { type: 'string', description: 'Research goals/objectives. Supports templates.' },
      depth: { type: 'string', description: 'Research depth (shallow | medium | deep)' },
      sessionId: { type: 'string', description: 'Session ID for status/report/control. Supports templates.' },
      action: { type: 'string', description: 'Control action (pause | resume | cancel)' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'list' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation', label: 'Action', type: 'dropdown',
      description: 'What to do with research sessions',
      options: [
        { value: 'start', label: 'Start Research' },
        { value: 'status', label: 'Check Status' },
        { value: 'list', label: 'List Sessions' },
        { value: 'report', label: 'Get Report' },
        { value: 'control', label: 'Control Session' },
      ],
    },
    {
      key: 'topic', label: 'Topic', type: 'template-textarea',
      placeholder: 'Impact of AI on software engineering',
      description: 'The subject to research.',
      visibleWhen: { key: 'operation', equals: 'start' },
    },
    {
      key: 'goals', label: 'Goals', type: 'template-textarea',
      placeholder: 'Understand trends, key players, future outlook',
      description: 'Objectives and questions to address in the research.',
      visibleWhen: { key: 'operation', equals: 'start' },
    },
    {
      key: 'depth', label: 'Depth', type: 'dropdown',
      description: 'How thorough the research should be',
      options: [
        { value: 'shallow', label: 'Shallow (quick skim)' },
        { value: 'medium', label: 'Medium (balanced)' },
        { value: 'deep', label: 'Deep (thorough)' },
      ],
      visibleWhen: { key: 'operation', equals: 'start' },
    },
    {
      key: 'sessionId', label: 'Session ID', type: 'template-textarea',
      placeholder: '{{input.data.id}}',
      description: 'ID of the research session to check or control.',
      visibleWhen: { key: 'operation', in: ['status', 'report', 'control'] },
    },
    {
      key: 'action', label: 'Control Action', type: 'dropdown',
      description: 'What to do with the running session',
      options: [
        { value: 'pause', label: 'Pause' },
        { value: 'resume', label: 'Resume' },
        { value: 'cancel', label: 'Cancel' },
      ],
      visibleWhen: { key: 'operation', equals: 'control' },
    },
  ],
  llmDescription: `Run deep research sessions on any topic using web search, analysis, and synthesis. Supports five operations:

1. **start** — Start a new research session with a topic, optional goals, and depth level
2. **status** — Check the progress of a research session by ID
3. **list** — List all research sessions (most recent first, up to 50)
4. **report** — Get the full research report for a completed session
5. **control** — Control a running session (pause, resume, cancel)

IMPORTANT: Downstream nodes access this node's result as \`input.success\`, \`input.data\`, \`input.error\` (the upstream output is merged directly into the downstream input).

All text fields support \`{{input.field}}\` template interpolation.`,
  llmExamples: [
    { operation: 'list' },
    { operation: 'start', topic: 'Quantum computing breakthroughs 2026', goals: 'Key advances, practical applications', depth: 'deep' },
    { operation: 'status', sessionId: '{{input.data.id}}' },
    { operation: 'report', sessionId: '{{input.data.id}}' },
  ],
};
