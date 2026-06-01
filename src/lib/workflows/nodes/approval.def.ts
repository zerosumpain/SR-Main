import type { NodeDefinition } from '../types';

export const approvalDef: NodeDefinition = {
  type: 'approval',
  label: 'Approval',
  category: 'control',
  description:
    'Pauses the workflow for a human to approve or reject. On approve, the input passes through (approved: true) down the "approved" handle; on reject it routes down the "rejected" handle (approved: false).',
  configSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Instruction shown to the human when deciding.',
      },
      timeoutMinutes: {
        type: 'number',
        description: 'Auto-cancel the pending approval after N minutes (default 60).',
      },
      decisionPath: {
        type: 'string',
        description:
          'Optional dot-path into input that already holds a boolean decision. When present and boolean, the node resolves immediately WITHOUT pausing — useful for fully-automated approval gates.',
      },
    },
    required: ['prompt'],
  },
  defaultConfig: {
    prompt: 'Approve to continue?',
    timeoutMinutes: 60,
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [
    { name: 'approved', type: 'any', label: 'Approved' },
    { name: 'rejected', type: 'any', label: 'Rejected' },
  ],
  basicConfig: [
    {
      key: 'prompt',
      label: 'Prompt',
      type: 'template-textarea',
      placeholder: 'Approve sending this email?',
      description: 'What the human is asked to approve or reject.',
    },
    {
      key: 'decisionPath',
      label: 'Auto-decision path',
      type: 'text',
      placeholder: 'input.autoApprove',
      description: 'Optional. Dot-path into input holding a boolean; if set, the node decides without pausing.',
      section: 'ADVANCED',
      advancedOnly: true,
    },
    {
      key: 'timeoutMinutes',
      label: 'Timeout (minutes)',
      type: 'number',
      description: 'Auto-cancel the approval after this many minutes.',
      min: 1,
      section: 'ADVANCED',
      advancedOnly: true,
    },
  ],
  llmDescription:
    'A human approve/reject gate. Pauses the run and waits for a person to decide from the canvas. On approve the original input passes through with approved:true; on reject the input passes through with approved:false. Branch downstream on the decision: connect the "approved" output handle to the go-ahead path and the "rejected" handle to the cancel path using sourceHandle in connect_nodes. The human submits a boolean field named `approved`; the resumed output is { approved, completed, formValues, ... } — downstream nodes can also read input.approved. To make the gate fully automated (no human), set decisionPath to a dot-path into the input holding a boolean (e.g. "input.autoApprove"); the node then resolves immediately without pausing. Place upstream of any side-effecting node (send email, publish, delete) that needs sign-off.',
  llmExamples: [
    { prompt: 'Approve sending this email?' },
    { prompt: 'Publish this post?', decisionPath: 'input.autoApprove' },
  ],
};
