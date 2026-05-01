import { describe, it, expect } from 'vitest';
import {
  resolveUpstreamSchema,
  schemaToVariablePaths,
} from '$lib/workflows/schema-propagation';
import type {
  WorkflowNodeDef,
  WorkflowEdgeDef,
  JsonSchema,
} from '$lib/workflows/types';

function node(id: string, type = 'code-execute', config: Record<string, unknown> = {}): WorkflowNodeDef {
  return { id, type, position: { x: 0, y: 0 }, config, label: id };
}

function edge(sourceNodeId: string, targetNodeId: string, sourceHandle?: string): WorkflowEdgeDef {
  return { id: `${sourceNodeId}->${targetNodeId}`, sourceNodeId, targetNodeId, sourceHandle };
}

// Mock schema getter — returns known schemas by node type
function mockGetOutputSchema(type: string, config: Record<string, unknown>): JsonSchema {
  // Check for outputSchema annotation first (code-execute, transform)
  if (config.outputSchema && typeof config.outputSchema === 'object') {
    return config.outputSchema as JsonSchema;
  }

  const schemas: Record<string, JsonSchema> = {
    'manual-trigger': {
      type: 'object',
      properties: { data: { type: 'object', description: 'Initial trigger data' } },
    },
    'http-request': {
      type: 'object',
      properties: {
        status: { type: 'number' },
        headers: { type: 'object' },
        body: { type: 'any' },
      },
    },
    'llm-call': {
      type: 'object',
      properties: {
        response: { type: 'string', description: 'LLM response text' },
        usage: {
          type: 'object',
          properties: {
            promptTokens: { type: 'number' },
            completionTokens: { type: 'number' },
          },
        },
      },
    },
    'conditional': { type: 'object', description: 'Input passed through' },
  };
  return schemas[type] || { type: 'object' };
}

describe('resolveUpstreamSchema', () => {
  it('returns empty schema for trigger nodes (no incoming edges)', () => {
    const nodes = [node('trigger', 'manual-trigger')];
    const edges: WorkflowEdgeDef[] = [];

    const result = resolveUpstreamSchema('trigger', nodes, edges, mockGetOutputSchema);
    expect(result).toEqual({ type: 'object', properties: {} });
  });

  it('resolves single upstream node schema', () => {
    const nodes = [
      node('trigger', 'manual-trigger'),
      node('llm', 'llm-call'),
    ];
    const edges = [edge('trigger', 'llm')];

    const result = resolveUpstreamSchema('llm', nodes, edges, mockGetOutputSchema);

    // Should have flat properties from manual-trigger output
    expect(result.properties).toHaveProperty('data');
  });

  it('merges schemas from multiple upstream nodes (flat)', () => {
    const nodes = [
      node('trigger', 'manual-trigger'),
      node('http', 'http-request'),
      node('llm', 'llm-call'),
      node('target', 'code-execute'),
    ];
    const edges = [
      edge('trigger', 'http'),
      edge('trigger', 'llm'),
      edge('http', 'target'),
      edge('llm', 'target'),
    ];

    const result = resolveUpstreamSchema('target', nodes, edges, mockGetOutputSchema);

    // Should have properties from BOTH HTTP and LLM outputs, merged flat
    expect(result.properties).toHaveProperty('status'); // from http-request
    expect(result.properties).toHaveProperty('headers'); // from http-request
    expect(result.properties).toHaveProperty('body'); // from http-request
    expect(result.properties).toHaveProperty('response'); // from llm-call
    expect(result.properties).toHaveProperty('usage'); // from llm-call
  });

  it('uses outputSchema annotation from code-execute config', () => {
    const nodes = [
      node('trigger', 'manual-trigger'),
      node('code', 'code-execute', {
        code: 'return { score: 42 }',
        outputSchema: {
          type: 'object',
          properties: { score: { type: 'number' } },
        },
      }),
      node('next', 'llm-call'),
    ];
    const edges = [
      edge('trigger', 'code'),
      edge('code', 'next'),
    ];

    const result = resolveUpstreamSchema('next', nodes, edges, mockGetOutputSchema);

    expect(result.properties).toHaveProperty('score');
    expect(result.properties!.score).toEqual({ type: 'number' });
  });

  it('handles conditional branches — merges both sides', () => {
    const nodes = [
      node('cond', 'conditional'),
      node('a', 'http-request'),
      node('b', 'llm-call'),
      node('merge', 'code-execute'),
    ];
    const edges = [
      edge('cond', 'a', 'true'),
      edge('cond', 'b', 'false'),
      edge('a', 'merge'),
      edge('b', 'merge'),
    ];

    const result = resolveUpstreamSchema('merge', nodes, edges, mockGetOutputSchema);

    // Both branches contribute their properties
    expect(result.properties).toHaveProperty('status'); // from http-request (a)
    expect(result.properties).toHaveProperty('response'); // from llm-call (b)
  });

  it('later upstream overwrites earlier on key conflict', () => {
    const nodes = [
      node('a', 'http-request'), // outputs { status, headers, body }
      node('b', 'http-request'), // also outputs { status, headers, body }
      node('target', 'code-execute'),
    ];
    const edges = [
      edge('a', 'target'),
      edge('b', 'target'),
    ];

    const result = resolveUpstreamSchema('target', nodes, edges, mockGetOutputSchema);

    // Should still have the properties — last one wins on collision
    expect(result.properties).toHaveProperty('status');
    expect(result.properties).toHaveProperty('headers');
    expect(result.properties).toHaveProperty('body');
  });

  it('returns empty schema when target node has no incoming edges', () => {
    const result = resolveUpstreamSchema('nonexistent', [], [], mockGetOutputSchema);
    expect(result).toEqual({ type: 'object', properties: {} });
  });

  it('skips edges from nonexistent source nodes', () => {
    const nodes = [node('target', 'code-execute')];
    const edges = [edge('ghost', 'target')];

    const result = resolveUpstreamSchema('target', nodes, edges, mockGetOutputSchema);
    expect(result).toEqual({ type: 'object', properties: {} });
  });

  it('resolves Think node output schema for downstream nodes', () => {
    const nodes = [
      node('trigger', 'manual-trigger'),
      node('think', 'think'),
      node('next', 'conditional'),
    ];
    const edges = [
      edge('trigger', 'think'),
      edge('think', 'next'),
    ];

    function getOutput(type: string): JsonSchema {
      if (type === 'think') {
        return {
          type: 'object',
          properties: {
            reasoning: { type: 'string', description: 'Step-by-step reasoning' },
            conclusion: { type: 'string', description: 'Final conclusion' },
            fullResponse: { type: 'string' },
          },
        };
      }
      return mockGetOutputSchema(type, {});
    }

    const schema = resolveUpstreamSchema('next', nodes, edges, getOutput);
    expect(schema.properties).toHaveProperty('reasoning');
    expect(schema.properties).toHaveProperty('conclusion');
    expect(schema.properties).toHaveProperty('fullResponse');
  });

  it('resolves Validator node output for retry loops', () => {
    const nodes = [
      node('validator', 'validator'),
      node('retry', 'llm-call'),
    ];
    const edges = [edge('validator', 'retry', 'fail')];

    function getOutput(type: string): JsonSchema {
      if (type === 'validator') {
        return {
          type: 'object',
          properties: {
            valid: { type: 'boolean' },
            errors: { type: 'array', description: 'Validation error messages' },
          },
        };
      }
      return mockGetOutputSchema(type, {});
    }

    const schema = resolveUpstreamSchema('retry', nodes, edges, getOutput);
    expect(schema.properties).toHaveProperty('valid');
    expect(schema.properties).toHaveProperty('errors');
  });

  it('returns an empty schema for nodes whose immediate upstream is a loop', () => {
    // A `loop` node iterates over an array, so each iteration's downstream
    // body sees the array element as `input` — NOT the loop's {results, count}
    // output shape. The verifier needs an empty schema to skip false-positive
    // reference errors like "input.title not found in upstream schema".
    const nodes = [
      node('upstream', 'http-request'),
      node('loop1', 'loop'),
      node('classify', 'llm-call'),
    ];
    const edges = [edge('upstream', 'loop1'), edge('loop1', 'classify')];
    const schema = resolveUpstreamSchema('classify', nodes, edges, mockGetOutputSchema);
    expect(schema.properties).toEqual({});
  });
});

describe('schemaToVariablePaths', () => {
  it('flattens a simple schema to paths', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        response: { type: 'string', description: 'LLM response' },
        status: { type: 'number' },
      },
    };

    const paths = schemaToVariablePaths(schema);
    expect(paths).toEqual([
      { path: 'response', type: 'string', description: 'LLM response' },
      { path: 'status', type: 'number', description: undefined },
    ]);
  });

  it('flattens nested objects with dot notation', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        usage: {
          type: 'object',
          properties: {
            promptTokens: { type: 'number' },
            completionTokens: { type: 'number' },
          },
        },
      },
    };

    const paths = schemaToVariablePaths(schema);
    expect(paths).toContainEqual({ path: 'usage', type: 'object', description: undefined });
    expect(paths).toContainEqual({ path: 'usage.promptTokens', type: 'number', description: undefined });
    expect(paths).toContainEqual({ path: 'usage.completionTokens', type: 'number', description: undefined });
  });

  it('handles deeply nested objects', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        a: {
          type: 'object',
          properties: {
            b: {
              type: 'object',
              properties: {
                c: { type: 'string', description: 'Deep' },
              },
            },
          },
        },
      },
    };

    const paths = schemaToVariablePaths(schema);
    expect(paths).toContainEqual({ path: 'a', type: 'object', description: undefined });
    expect(paths).toContainEqual({ path: 'a.b', type: 'object', description: undefined });
    expect(paths).toContainEqual({ path: 'a.b.c', type: 'string', description: 'Deep' });
  });

  it('uses prefix when provided', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { value: { type: 'string' } },
    };

    const paths = schemaToVariablePaths(schema, 'node1');
    expect(paths).toEqual([
      { path: 'node1.value', type: 'string', description: undefined },
    ]);
  });

  it('returns empty array for schema with no properties', () => {
    expect(schemaToVariablePaths({ type: 'object' })).toEqual([]);
  });
});
