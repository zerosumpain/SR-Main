import { describe, it, expect } from 'vitest';
import { orchestratorChats } from '$lib/db/schema';
import { accumulatorExecutor } from '$lib/workflows/nodes/accumulator';

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

describe('node output schemas have properties', () => {
  it('accumulator declares items and count', () => {
    const schema = accumulatorExecutor.getOutputSchema({});
    expect(schema.properties).toBeDefined();
    expect(schema.properties).toHaveProperty('items');
    expect(schema.properties).toHaveProperty('count');
  });
});
