import type { NodeDefinition } from '../types';

export const builderChatDef: NodeDefinition = {
  type: 'builder-chat',
  label: 'Builder Chat',
  category: 'integration',
  description:
    'Set the build outcome and config. Programmatic: starts a JKAI build with the configured prompt and emits the buildId.',
  configSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Build outcome prompt. Supports templates.' },
      thinkingLevel: { type: 'string' },
      enforceDesignSystem: { type: 'boolean' },
      planFirst: { type: 'boolean' },
      modelProvider: { type: 'string' },
      modelId: { type: 'string' },
      minIterations: { type: 'number' },
      maxIterations: { type: 'number' },
      maxTotalMinutes: { type: 'number' },
      maxTokensPerHour: { type: 'number' },
      activeMinutesPerHour: { type: 'number' },
    },
    required: ['prompt'],
  },
  defaultConfig: { prompt: '', thinkingLevel: 'medium', enforceDesignSystem: true, planFirst: false },
  inputs: [{ name: 'input', type: 'any', label: 'Input (for templating)' }],
  outputs: [{ name: 'output', type: 'object', label: 'Started build' }],
  llmDescription:
    'Start a JKAI autonomous build with a prompt and full config. Returns buildId for downstream Builder Pi / Build View nodes.',
};

export const builderPiDef: NodeDefinition = {
  type: 'builder-pi',
  label: 'Builder Pi',
  category: 'integration',
  description:
    'Live terminal for an active build. Programmatic: waits for the build to reach a terminal state (completed/failed/paused) and emits its final snapshot.',
  configSchema: {
    type: 'object',
    properties: {
      buildId: { type: 'string', description: 'Target build id (templates supported).' },
      pollIntervalMs: { type: 'number', description: 'Poll interval while waiting for terminal state.' },
      maxWaitMs: { type: 'number', description: 'Max wait before bailing out.' },
    },
    required: [],
  },
  defaultConfig: { buildId: '', waitForCompletion: false, pollIntervalMs: 2000, maxWaitMs: 8 * 60 * 60 * 1000 },
  inputs: [{ name: 'input', type: 'any', label: 'Input (expects { buildId } if not configured)' }],
  outputs: [{ name: 'output', type: 'object', label: 'Build snapshot' }],
  llmDescription:
    'Snapshot a JKAI build (default) or, with waitForCompletion, poll until terminal. Always emits buildId + status + iteration progress.',
};

export const buildViewDef: NodeDefinition = {
  type: 'build-view',
  label: 'Build View',
  category: 'integration',
  description: 'Snapshot of an in-progress or finished JKAI build (status, preview URL, published slug).',
  configSchema: {
    type: 'object',
    properties: {
      buildId: { type: 'string', description: 'Target build id (templates supported).' },
    },
    required: [],
  },
  defaultConfig: { buildId: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input (expects { buildId } if not configured)' }],
  outputs: [{ name: 'output', type: 'object', label: 'Build snapshot' }],
  llmDescription: 'Read the current state of a JKAI build without waiting.',
};
