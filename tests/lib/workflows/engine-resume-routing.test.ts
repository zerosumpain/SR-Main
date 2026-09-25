import { describe, it, expect, vi } from 'vitest';

// The approval executor registers a pending interaction and (optionally) pings
// WhatsApp before returning its pause sentinel. Neither is what this test is
// about, and both would touch the DB / the phone.
vi.mock('$lib/workflows/engine-interactions', () => ({
  createInteraction: vi.fn(async () => 1),
}));
vi.mock('$lib/workflows/whatsapp/approval-notify', () => ({
  planApprovalNotification: vi.fn(async () => null),
  sendApprovalPendingMessage: vi.fn(),
  WA_APPROVAL_SNAPSHOT_KEY: '_waApproval',
}));

import { WorkflowEngine } from '$lib/workflows/engine';
import { NodeRegistry } from '$lib/workflows/registry';
import { manualTriggerDef, manualTriggerExecutor } from '$lib/workflows/nodes/manual-trigger';
import { transformDef, transformExecutor } from '$lib/workflows/nodes/transform';
import { conditionalDef, conditionalExecutor } from '$lib/workflows/nodes/conditional';
import { approvalDef, approvalExecutor } from '$lib/workflows/nodes/approval';
import { buildResumeSeed } from '$lib/workflows/resume-seed';
import type { WorkflowDefinition } from '$lib/workflows/types';

function makeEngine() {
  const registry = new NodeRegistry();
  registry.register(manualTriggerDef, manualTriggerExecutor);
  registry.register(transformDef, transformExecutor);
  registry.register(conditionalDef, conditionalExecutor);
  registry.register(approvalDef, approvalExecutor);
  return { engine: new WorkflowEngine(registry), registry };
}

// trigger → cond ─true→ appr ─approved→ yes
//               │             └rejected→ no
//               └false→ other
const workflow: WorkflowDefinition = {
  id: 'wf-resume',
  name: 'Resume routing',
  nodes: [
    { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
    { id: 'cond', type: 'conditional', position: { x: 1, y: 0 }, config: { expression: 'input.x > 5' }, label: 'Big?' },
    { id: 'appr', type: 'approval', position: { x: 2, y: 0 }, config: { prompt: 'Go?' }, label: 'Approve' },
    { id: 'yes', type: 'transform', position: { x: 3, y: 0 }, config: { expression: 'return { branch: "approved" }' }, label: 'Yes' },
    { id: 'no', type: 'transform', position: { x: 3, y: 1 }, config: { expression: 'return { branch: "rejected" }' }, label: 'No' },
    { id: 'other', type: 'transform', position: { x: 2, y: 1 }, config: { expression: 'return { branch: "small" }' }, label: 'Other' },
  ],
  edges: [
    { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'cond' },
    { id: 'e2', sourceNodeId: 'cond', targetNodeId: 'appr', sourceHandle: 'true' },
    { id: 'e3', sourceNodeId: 'cond', targetNodeId: 'other', sourceHandle: 'false' },
    { id: 'e4', sourceNodeId: 'appr', targetNodeId: 'yes', sourceHandle: 'approved' },
    { id: 'e5', sourceNodeId: 'appr', targetNodeId: 'no', sourceHandle: 'rejected' },
  ],
};

/** Shape the first run's result the way node_executions would hold it. */
function executionsFrom(result: Awaited<ReturnType<WorkflowEngine['execute']>>) {
  return [...result.nodeOutputs.entries()].map(([nodeId, outputData]) => ({
    nodeId,
    status: 'completed',
    inputData: result.nodeInputs.get(nodeId) ?? null,
    outputData,
    selectedHandle: result.nodeSelectedHandles.get(nodeId) ?? null,
  }));
}

async function pauseThenResume(approved: boolean) {
  const { engine, registry } = makeEngine();
  const first = await engine.execute(workflow, `run-pause-${approved}`, { x: 10 }, undefined, 'wf-resume');
  expect(first.status).toBe('awaiting_human');
  expect(first.pausedAtNodeId).toBe('appr');

  const seed = buildResumeSeed({
    executions: executionsFrom(first),
    pausedNodeId: 'appr',
    pausedNodeInput: first.nodeInputs.get('appr') ?? {},
    resolved: { completed: true, formValues: { approved } },
    executor: registry.getExecutor('approval'),
  });
  const second = await engine.executeWithPreSeededOutputs(
    workflow,
    `run-pause-${approved}`,
    seed.outputs,
    'wf-resume',
    undefined,
    seed.handles,
  );
  return { first, seed, second };
}

describe('engine resume routing', () => {
  it('records the handle each branching node selected', async () => {
    const { engine } = makeEngine();
    const result = await engine.execute(workflow, 'run-handles', { x: 10 }, undefined, 'wf-resume');
    expect(result.nodeSelectedHandles.get('cond')).toBe('true');
    // The trigger does not branch, so it records nothing.
    expect(result.nodeSelectedHandles.has('trigger')).toBe(false);
  });

  it('approval → rejected runs ONLY the rejected branch', async () => {
    const { seed, second } = await pauseThenResume(false);
    expect(seed.handles.appr).toBe('rejected');
    expect(seed.outputs.appr).toMatchObject({ approved: false });
    expect(second.status).toBe('completed');
    expect(second.nodeOutputs.get('no')).toEqual({ branch: 'rejected' });
    expect(second.nodeOutputs.has('yes')).toBe(false);
  });

  it('approval → approved runs ONLY the approved branch', async () => {
    const { seed, second } = await pauseThenResume(true);
    expect(seed.handles.appr).toBe('approved');
    expect(second.nodeOutputs.get('yes')).toEqual({ branch: 'approved' });
    expect(second.nodeOutputs.has('no')).toBe(false);
  });

  it('a branch NOT taken before the pause stays skipped after the resume', async () => {
    const { second } = await pauseThenResume(true);
    // cond chose `true` before the pause, so `other` must not run on resume.
    expect(second.nodeOutputs.has('other')).toBe(false);
  });

  it('the resumed approval carries the upstream input through, plus the decision', async () => {
    const { first, seed } = await pauseThenResume(false);
    const apprInput = first.nodeInputs.get('appr') ?? {};
    expect(seed.outputs.appr).toMatchObject({ ...apprInput, approved: false });
  });
});
