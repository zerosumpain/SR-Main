import type { NodeDefinition } from '../types';

export const subWorkflowDef: NodeDefinition = {
  type: 'sub-workflow', label: 'Sub-Workflow', category: 'control',
  description: 'Execute another saved workflow as a step. Passes input to the sub-workflow and returns its output.',
  configSchema: { type: 'object', properties: {
    workflowId: { type: 'string', description: 'ID of the workflow to execute' },
  }, required: ['workflowId'] },
  defaultConfig: { workflowId: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  basicConfig: [
    {
      key: 'workflowId',
      label: 'Workflow ID',
      type: 'text',
      placeholder: 'Paste workflow ID here',
      description:
        'The ID of the workflow to run. Find it in the URL of the workflow edit page.',
    },
  ],
  llmDescription: 'Use to compose workflows — call a pre-built workflow as a reusable step. Essential for building complex agentic systems from smaller building blocks.',
};
