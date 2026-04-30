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
  llmDescription:
    "Execute another saved workflow as a single step in this one. Pass the upstream node's output as the sub-workflow's input; receive the sub-workflow's output as this node's output. Use to compose reusable building blocks: e.g. a 'send-via-whatsapp-or-fallback-email' helper called from many parent workflows, or a per-item processor invoked inside a parent. The workflowId must reference a real saved workflow — pick from the 'Workflows (sub-workflow candidates)' list in Workspace Resources, do NOT invent ids. Recursion is rejected at run time, so don't reference the current workflow's own id.",
  llmExamples: [
    { workflowId: '{{input.helperWorkflowId}}' },
    { workflowId: 'a3f1c4b2-7d8e-4f5a-9b6c-1d2e3f4a5b6c' },
  ],
};
