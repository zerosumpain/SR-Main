import type { NodeDefinition } from '../types';

export const errorHandlerDef: NodeDefinition = {
  type: 'error-handler',
  label: 'Error Handler',
  category: 'control',
  description:
    'Routes to success or error output based on error detection: checks for an explicit error field OR HTTP status codes >= 400 from upstream http-request nodes.',
  configSchema: {
    type: 'object',
    properties: {},
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [
    { name: 'success', type: 'any', label: 'Success' },
    { name: 'error', type: 'any', label: 'Error' },
  ],
  // No configuration — routes automatically based on error detection.
  basicConfig: [],
  llmDescription: 'Place BETWEEN http-request and its downstream consumer (e.g. transform). Detects errors two ways: (1) explicit input.error field, (2) HTTP status >= 400 from upstream http-request. Routes to "success" or "error" output handle. IMPORTANT: Do NOT wire http-request to both error-handler AND directly to the next node — that bypasses error detection. Wire: http-request → error-handler → (success) → transform.',
};
