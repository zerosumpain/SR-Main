import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { interpolateTemplate } from './template';

export const deepDiveExecutor: NodeExecutor = {
  type: 'deep-dive',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = config.operation as string | undefined;
    if (!operation) {
      return { output: { success: false, error: 'No operation configured' } };
    }

    switch (operation) {
      case 'start': {
        const topic = interpolateTemplate((config.topic as string) || '', input);
        const goals = interpolateTemplate((config.goals as string) || '', input);
        if (!topic) return { output: { success: false, error: 'Topic is required to start research' } };
        const args: Record<string, unknown> = { topic };
        if (goals) args.goals = goals;
        if (config.depth) args.depth = config.depth;
        const result = await executeSiteTool('research_start', args);
        return { output: result };
      }

      case 'status': {
        const sessionId = interpolateTemplate((config.sessionId as string) || '', input);
        if (!sessionId) return { output: { success: false, error: 'Session ID is required' } };
        const result = await executeSiteTool('research_status', { sessionId });
        return { output: result };
      }

      case 'list': {
        const result = await executeSiteTool('research_list', {});
        return { output: result };
      }

      case 'report': {
        const sessionId = interpolateTemplate((config.sessionId as string) || '', input);
        if (!sessionId) return { output: { success: false, error: 'Session ID is required for report' } };
        const result = await executeSiteTool('research_report', { sessionId });
        return { output: result };
      }

      case 'control': {
        const sessionId = interpolateTemplate((config.sessionId as string) || '', input);
        const action = config.action as string;
        if (!sessionId) return { output: { success: false, error: 'Session ID is required' } };
        if (!action) return { output: { success: false, error: 'Action is required' } };
        const result = await executeSiteTool('research_control', { sessionId, action });
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

export const deepDiveDef: NodeDefinition = {
  type: 'deep-dive',
  label: 'Deep Dive',
  category: 'integration',
  description: 'Run deep research sessions: start, check status, list, get reports, and control.',
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
      key: 'operation', label: 'Operation', type: 'dropdown',
      options: [
        { value: 'start', label: 'Start Research' },
        { value: 'status', label: 'Check Status' },
        { value: 'list', label: 'List Sessions' },
        { value: 'report', label: 'Get Report' },
        { value: 'control', label: 'Control Session' },
      ],
    },
    { key: 'topic', label: 'Topic', type: 'template-textarea', placeholder: 'Impact of AI on software engineering' },
    { key: 'goals', label: 'Goals', type: 'textarea', placeholder: 'Understand trends, key players, future outlook' },
    {
      key: 'depth', label: 'Depth', type: 'dropdown',
      options: [
        { value: 'shallow', label: 'Shallow' },
        { value: 'medium', label: 'Medium' },
        { value: 'deep', label: 'Deep' },
      ],
    },
    { key: 'sessionId', label: 'Session ID', type: 'template-textarea', placeholder: '{{input.data.id}}' },
    {
      key: 'action', label: 'Action', type: 'dropdown',
      options: [
        { value: 'pause', label: 'Pause' },
        { value: 'resume', label: 'Resume' },
        { value: 'cancel', label: 'Cancel' },
      ],
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
