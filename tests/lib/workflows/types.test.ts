import { describe, it, expect } from 'vitest';
import {
  workflows,
  workflowNodes,
  workflowEdges,
  workflowRuns,
  nodeExecutions,
  workflowSchedules,
  integrations,
} from '$lib/db/schema';

describe('workflow schema', () => {
  it('workflows table has expected columns', () => {
    expect(workflows.id).toBeDefined();
    expect(workflows.name).toBeDefined();
    expect(workflows.description).toBeDefined();
    expect(workflows.trigger).toBeDefined();
    expect(workflows.createdAt).toBeDefined();
    expect(workflows.updatedAt).toBeDefined();
  });

  it('workflowNodes table has expected columns', () => {
    expect(workflowNodes.id).toBeDefined();
    expect(workflowNodes.workflowId).toBeDefined();
    expect(workflowNodes.type).toBeDefined();
    expect(workflowNodes.position).toBeDefined();
    expect(workflowNodes.config).toBeDefined();
    expect(workflowNodes.label).toBeDefined();
  });

  it('workflowEdges table has expected columns', () => {
    expect(workflowEdges.id).toBeDefined();
    expect(workflowEdges.workflowId).toBeDefined();
    expect(workflowEdges.sourceNodeId).toBeDefined();
    expect(workflowEdges.targetNodeId).toBeDefined();
    expect(workflowEdges.sourceHandle).toBeDefined();
    expect(workflowEdges.targetHandle).toBeDefined();
  });

  it('workflowRuns table has expected columns', () => {
    expect(workflowRuns.id).toBeDefined();
    expect(workflowRuns.workflowId).toBeDefined();
    expect(workflowRuns.status).toBeDefined();
    expect(workflowRuns.trigger).toBeDefined();
    expect(workflowRuns.startedAt).toBeDefined();
    expect(workflowRuns.completedAt).toBeDefined();
    expect(workflowRuns.error).toBeDefined();
  });

  it('nodeExecutions table has expected columns', () => {
    expect(nodeExecutions.id).toBeDefined();
    expect(nodeExecutions.runId).toBeDefined();
    expect(nodeExecutions.nodeId).toBeDefined();
    expect(nodeExecutions.status).toBeDefined();
    expect(nodeExecutions.inputData).toBeDefined();
    expect(nodeExecutions.outputData).toBeDefined();
    expect(nodeExecutions.logs).toBeDefined();
  });

  it('workflowSchedules table has expected columns', () => {
    expect(workflowSchedules.id).toBeDefined();
    expect(workflowSchedules.workflowId).toBeDefined();
    expect(workflowSchedules.type).toBeDefined();
    expect(workflowSchedules.config).toBeDefined();
    expect(workflowSchedules.enabled).toBeDefined();
  });

  it('integrations table has expected columns', () => {
    expect(integrations.id).toBeDefined();
    expect(integrations.name).toBeDefined();
    expect(integrations.baseUrl).toBeDefined();
    expect(integrations.authType).toBeDefined();
    expect(integrations.authConfig).toBeDefined();
    expect(integrations.operations).toBeDefined();
  });
});
