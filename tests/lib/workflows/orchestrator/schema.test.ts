import { describe, it, expect } from 'vitest';
import { orchestratorChats } from '$lib/db/schema';

describe('orchestrator chat schema', () => {
  it('has expected columns', () => {
    expect(orchestratorChats.id).toBeDefined();
    expect(orchestratorChats.workflowId).toBeDefined();
    expect(orchestratorChats.role).toBeDefined();
    expect(orchestratorChats.content).toBeDefined();
    expect(orchestratorChats.metadata).toBeDefined();
    expect(orchestratorChats.createdAt).toBeDefined();
  });
});
