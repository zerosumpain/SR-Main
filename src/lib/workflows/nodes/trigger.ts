import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

/**
 * Trigger node — workflow entry point.
 *
 * The node itself is a passthrough: whatever `initialInput` the run
 * was kicked off with gets forwarded to downstream nodes. The actual
 * firing (manual / cron / webhook / event) happens in external code:
 *   - manual   → user clicks Run (or chat send)
 *   - cron     → workflowSchedules + scheduler.ts Cron jobs
 *   - webhook  → POST /api/workflows/webhook/:id
 *   - event    → event-bus + workflowSchedules type='event'
 *
 * The node's config mirrors `workflows.trigger` so the canvas UI can
 * display + edit it in one place without special-casing.
 */
export const triggerExecutor: NodeExecutor = {
  type: 'trigger',

  async execute(
    input: Record<string, unknown>,
    _config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    return { output: { ...input } };
  },

  getInputSchema() {
    return { type: 'object', description: 'No input — the trigger is the workflow entry.' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      description: 'Emits the run payload. For chat-kicked runs this carries { message, _chatNodeId, _conversationId }.',
    };
  },
};

export const triggerDef: NodeDefinition = {
  type: 'trigger',
  label: 'Trigger',
  category: 'trigger',
  description:
    'Workflow entry point. Configure to fire manually, on a cron schedule, via a webhook, or when another workflow completes.',
  configSchema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        description: 'manual | cron | webhook | event',
      },
      cron: {
        type: 'string',
        description: 'Cron expression (5-field). Only used when kind=cron.',
      },
      eventType: {
        type: 'string',
        description: 'Platform event to listen for (e.g. workflow_completed).',
      },
      sourceWorkflowId: {
        type: 'string',
        description: 'Only fire when this specific workflow emits the event (optional).',
      },
    },
  },
  defaultConfig: { kind: 'manual' },
  inputs: [],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  basicConfig: [],
};
