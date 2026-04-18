import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

export const subWorkflowExecutor: NodeExecutor = {
  type: 'sub-workflow',
  async execute(input, config, context): Promise<NodeResult> {
    const workflowId = config.workflowId as string;
    if (!workflowId) return { output: { error: 'No workflowId configured' } };

    const response = await fetch(`http://localhost:5173/api/workflows/${workflowId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, waitForCompletion: true }),
      signal: context.abortSignal,
    });

    if (!response.ok) {
      const text = await response.text();
      return { output: { error: `Sub-workflow failed: ${text}` } };
    }

    const result = await response.json();
    return {
      output: result.output || result,
      metadata: { subRunId: result.runId, subWorkflowId: workflowId },
    };
  },
  getInputSchema() { return { type: 'object', description: 'Passed as initial input to the sub-workflow' }; },
  getOutputSchema() { return { type: 'object', description: "Output from the sub-workflow's final node" }; },
};

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
