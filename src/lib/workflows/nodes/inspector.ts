import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

/**
 * Inspector node — a passthrough "tap" for debugging workflow runs.
 *
 * Wire it downstream of any node (or any edge target) and it will capture
 * whatever that node emits. At render time the canvas reads the node's
 * inputData from node_executions and renders it via a format-aware UI
 * component: JSON → tables, CSV → tables, HTML → sandboxed iframe, image
 * / video / audio URLs → media element, plain text → mono.
 *
 * Execution-wise it just forwards input onward so the inspector can be
 * chained, a pattern useful for tee-style branches.
 */
export const inspectorExecutor: NodeExecutor = {
  type: 'inspector',

  async execute(
    input: Record<string, unknown>,
    _config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    return { output: { ...input }, rowCount: 1 };
  },

  getInputSchema() {
    return { type: 'object', description: 'Any payload — rendered verbatim in the canvas.' };
  },

  getOutputSchema() {
    return { type: 'object', description: 'Passes input through untouched.' };
  },
};

export const inspectorDef: NodeDefinition = {
  type: 'inspector',
  label: 'Inspector',
  category: 'core',
  description:
    'Runtime debug view. Captures the upstream node\'s output and renders it as JSON, tables, HTML, images, video, audio, or plain text.',
  configSchema: {
    type: 'object',
    properties: {
      size: {
        type: 'object',
        description: 'Rendered width/height (user-resizable).',
      },
    },
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Captured' }],
  outputs: [{ name: 'output', type: 'any', label: 'Passthrough' }],
  basicConfig: [],
};
