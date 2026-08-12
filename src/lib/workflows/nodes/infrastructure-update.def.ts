import type { NodeDefinition } from '../types';

export const infrastructureUpdateDef: NodeDefinition = {
  type: 'infrastructure-update', label: 'Infrastructure update', category: 'control',
  description: 'Approval-gated executor for a small server-side allowlist. Refuses arbitrary commands, packages and services.',
  configSchema: { type: 'object', properties: { action: { type: 'string', description: 'verify_only | home_assistant_check' } } },
  defaultConfig: { action: 'verify_only' },
  inputs: [{ name: 'manifest', type: 'object', label: 'Approved manifest' }],
  outputs: [{ name: 'result', type: 'object', label: 'Verification result' }],
  basicConfig: [{ key: 'action', label: 'Safe action', type: 'dropdown', options: [
    { value: 'verify_only', label: 'Post-update verification only' }, { value: 'home_assistant_check', label: 'Verify Home Assistant connectivity' },
  ], description: 'The manifest must match this enumerable action and arrive from an approved upstream branch.' }],
  llmDescription: 'Use only after an approval node. Accepts a prevalidated manifest whose action is one of verify_only or home_assistant_check. It never accepts shell, package, service, host or command input.',
  llmExamples: [{ action: 'verify_only' }],
};
