import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { interpolateTemplate } from './template';

export const jkaiExecutor: NodeExecutor = {
  type: 'jkai',

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
        const prompt = interpolateTemplate((config.prompt as string) || '', input);
        const title = interpolateTemplate((config.title as string) || '', input);
        if (!prompt) return { output: { success: false, error: 'Prompt is required to start a build' } };
        const args: Record<string, unknown> = { prompt };
        if (title) args.title = title;
        const result = await executeSiteTool('jkai_start', args);
        return { output: result };
      }

      case 'status': {
        const buildId = interpolateTemplate((config.buildId as string) || '', input);
        if (!buildId) return { output: { success: false, error: 'Build ID is required' } };
        const result = await executeSiteTool('jkai_status', { buildId });
        return { output: result };
      }

      case 'list': {
        const result = await executeSiteTool('jkai_list_builds', {});
        return { output: result };
      }

      case 'control': {
        const buildId = interpolateTemplate((config.buildId as string) || '', input);
        const action = config.action as string;
        if (!buildId) return { output: { success: false, error: 'Build ID is required' } };
        if (!action) return { output: { success: false, error: 'Action is required' } };
        const result = await executeSiteTool('jkai_control', { buildId, action });
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
        { value: 'start', label: 'Start Build' },
        { value: 'status', label: 'Check Status' },
        { value: 'list', label: 'List Builds' },
        { value: 'control', label: 'Control Build' },
      ],
    },
    { key: 'prompt', label: 'Prompt', type: 'template-textarea', placeholder: 'Build a landing page with...' },
    { key: 'title', label: 'Title', type: 'text', placeholder: 'My Build' },
    { key: 'buildId', label: 'Build ID', type: 'template-textarea', placeholder: '{{input.output.buildId}}' },
    {
      key: 'action', label: 'Action', type: 'dropdown',
      options: [
        { value: 'pause', label: 'Pause' },
        { value: 'resume', label: 'Resume' },
        { value: 'cancel', label: 'Cancel' },
      ],
    },
  ],
  llmDescription: `Manage JKAI autonomous code builds in a Docker sandbox. Supports four operations:

1. **start** — Start a new build with a prompt (and optional title)
2. **status** — Check the status of a build by ID
3. **list** — List all builds (most recent first, up to 50)
4. **control** — Control a running build (pause, resume, cancel)

IMPORTANT: Output is wrapped in \`output\`. Downstream nodes access \`input.output.success\`, \`input.output.data\`, \`input.output.error\`.

All text fields support \`{{input.field}}\` template interpolation.`,
  llmExamples: [
    { operation: 'list' },
    { operation: 'start', prompt: 'Build a React dashboard with charts', title: 'Dashboard Build' },
    { operation: 'status', buildId: '{{input.output.data.id}}' },
    { operation: 'control', buildId: '{{input.output.data.id}}', action: 'cancel' },
  ],
};
