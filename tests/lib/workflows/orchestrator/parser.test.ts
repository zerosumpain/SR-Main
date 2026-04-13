import { describe, it, expect } from 'vitest';
import { parseWorkflowResponse, extractJsonFromResponse } from '$lib/workflows/orchestrator/parser';

describe('extractJsonFromResponse', () => {
  it('extracts JSON from plain response', () => {
    const input = '{"name":"test","nodes":[],"edges":[],"explanation":"none"}';
    const result = extractJsonFromResponse(input);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test');
  });

  it('extracts JSON from markdown fenced response', () => {
    const input = '```json\n{"name":"test","nodes":[],"edges":[],"explanation":"none"}\n```';
    const result = extractJsonFromResponse(input);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test');
  });

  it('extracts JSON embedded in text', () => {
    const input = 'Here is the workflow:\n{"name":"test","nodes":[],"edges":[],"explanation":"none"}\nDone.';
    const result = extractJsonFromResponse(input);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test');
  });

  it('returns null for non-JSON response', () => {
    const result = extractJsonFromResponse('This is not JSON at all.');
    expect(result).toBeNull();
  });
});

describe('parseWorkflowResponse', () => {
  it('parses a valid workflow response', () => {
    const input = JSON.stringify({
      name: 'My Workflow',
      description: 'Test',
      nodes: [
        { id: 'n1', type: 'manual-trigger', position: { x: 100, y: 200 }, config: {}, label: 'Start' },
        { id: 'n2', type: 'transform', position: { x: 350, y: 200 }, config: { expression: 'return input' }, label: 'Transform' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' },
      ],
      explanation: 'Trigger then transform',
    });

    const result = parseWorkflowResponse(input);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('My Workflow');
    expect(result!.nodes).toHaveLength(2);
    expect(result!.edges).toHaveLength(1);
    expect(result!.explanation).toBe('Trigger then transform');
  });

  it('returns null if nodes missing', () => {
    const result = parseWorkflowResponse('{"name":"test","edges":[]}');
    expect(result).toBeNull();
  });

  it('generates IDs if missing', () => {
    const input = JSON.stringify({
      name: 'Test',
      nodes: [
        { type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
      ],
      edges: [],
      explanation: 'test',
    });

    const result = parseWorkflowResponse(input);
    expect(result).not.toBeNull();
    expect(result!.nodes[0].id).toBeDefined();
    expect(result!.nodes[0].id.length).toBeGreaterThan(0);
  });

  it('defaults position if missing', () => {
    const input = JSON.stringify({
      name: 'Test',
      nodes: [
        { id: 'n1', type: 'manual-trigger', config: {}, label: 'Start' },
      ],
      edges: [],
      explanation: 'test',
    });

    const result = parseWorkflowResponse(input);
    expect(result!.nodes[0].position).toEqual({ x: 0, y: 0 });
  });
});
