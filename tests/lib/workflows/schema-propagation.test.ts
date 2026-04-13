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

function edge(sourceNodeId: string, targetNodeId: string): WorkflowEdgeDef {
  return { id: `${sourceNodeId}->${targetNodeId}`, sourceNodeId, targetNodeId };
}

describe('resolveUpstreamSchema', () => {
  it('returns empty schema for trigger nodes (no incoming edges)', () => {
    const nodes = [node('trigger1', 'webhook-trigger')];
    const edges: WorkflowEdgeDef[] = [];
    const getOutputSchema = () => ({ type: 'object', properties: {} });

    const result = resolveUpstreamSchema('trigger1', nodes, edges, getOutputSchema);

    expect(result).toEqual({ type: 'object', properties: {} });
  });

  it('resolves single upstream node schema', () => {
    const nodes = [node('a'), node('b')];
    const edges = [edge('a', 'b')];
    const getOutputSchema = (n: WorkflowNodeDef): JsonSchema => {
      if (n.id === 'a') {
        return {
          type: 'object',
          properties: {
            result: { type: 'string', description: 'The result' },
          },
        };
      }
      return { type: 'object', properties: {} };
    };

    const result = resolveUpstreamSchema('b', nodes, edges, getOutputSchema);

    expect(result).toEqual({
      type: 'object',
      properties: {
        a: {
          type: 'object',
          properties: {
            result: { type: 'string', description: 'The result' },
          },
        },
      },
    });
  });

  it('merges schemas from multiple upstream nodes', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('a', 'c'), edge('b', 'c')];
    const getOutputSchema = (n: WorkflowNodeDef): JsonSchema => {
      if (n.id === 'a') {
        return {
          type: 'object',
          properties: { foo: { type: 'string' } },
        };
      }
      if (n.id === 'b') {
        return {
          type: 'object',
          properties: { bar: { type: 'number' } },
        };
      }
      return { type: 'object', properties: {} };
    };

    const result = resolveUpstreamSchema('c', nodes, edges, getOutputSchema);

    expect(result).toEqual({
      type: 'object',
      properties: {
        a: {
          type: 'object',
          properties: { foo: { type: 'string' } },
        },
        b: {
          type: 'object',
          properties: { bar: { type: 'number' } },
        },
      },
    });
  });

  it('uses outputSchema annotation from code-execute config', () => {
    const outputSchema: JsonSchema = {
      type: 'object',
      properties: { total: { type: 'number' } },
    };
    const nodes = [node('a', 'code-execute', { outputSchema }), node('b')];
    const edges = [edge('a', 'b')];

    const getOutputSchema = (n: WorkflowNodeDef): JsonSchema => {
      if (n.config.outputSchema) {
        return n.config.outputSchema as JsonSchema;
      }
      return { type: 'object', properties: {} };
    };

    const result = resolveUpstreamSchema('b', nodes, edges, getOutputSchema);

    expect(result).toEqual({
      type: 'object',
      properties: {
        a: {
          type: 'object',
          properties: { total: { type: 'number' } },
        },
      },
    });
  });

  it('handles conditional branches (diamond pattern)', () => {
    // trigger -> condition -> [a, b] -> merge
    const nodes = [
      node('trigger', 'webhook-trigger'),
      node('condition', 'condition'),
      node('a'),
      node('b'),
      node('merge'),
    ];
    const edges = [
      edge('trigger', 'condition'),
      edge('condition', 'a'),
      edge('condition', 'b'),
      edge('a', 'merge'),
      edge('b', 'merge'),
    ];

    const getOutputSchema = (n: WorkflowNodeDef): JsonSchema => {
      if (n.id === 'a') {
        return { type: 'object', properties: { fromA: { type: 'string' } } };
      }
      if (n.id === 'b') {
        return { type: 'object', properties: { fromB: { type: 'number' } } };
      }
      return { type: 'object', properties: {} };
    };

    const result = resolveUpstreamSchema('merge', nodes, edges, getOutputSchema);

    // Both branches feed into merge
    expect(result.properties).toHaveProperty('a');
    expect(result.properties).toHaveProperty('b');
    expect(result.properties!.a).toEqual({
      type: 'object',
      properties: { fromA: { type: 'string' } },
    });
    expect(result.properties!.b).toEqual({
      type: 'object',
      properties: { fromB: { type: 'number' } },
    });
  });

  it('returns empty schema when target node is not found', () => {
    const result = resolveUpstreamSchema('nonexistent', [], [], () => ({
      type: 'object',
      properties: {},
    }));
    expect(result).toEqual({ type: 'object', properties: {} });
  });
});

describe('schemaToVariablePaths', () => {
  it('flattens simple schemas', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    };

    const paths = schemaToVariablePaths(schema);

    expect(paths).toEqual([
      { path: 'name', type: 'string', description: undefined },
      { path: 'age', type: 'number', description: undefined },
    ]);
  });

  it('handles nested objects with dot notation', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        usage: {
          type: 'object',
          properties: {
            promptTokens: { type: 'number', description: 'Token count' },
            completionTokens: { type: 'number' },
          },
        },
      },
    };

    const paths = schemaToVariablePaths(schema);

    expect(paths).toEqual([
      { path: 'usage', type: 'object', description: undefined },
      { path: 'usage.promptTokens', type: 'number', description: 'Token count' },
      { path: 'usage.completionTokens', type: 'number', description: undefined },
    ]);
  });

  it('uses prefix when provided', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
    };

    const paths = schemaToVariablePaths(schema, 'node1');

    expect(paths).toEqual([
      { path: 'node1.value', type: 'string', description: undefined },
    ]);
  });

  it('returns empty array for schema with no properties', () => {
    const schema: JsonSchema = { type: 'object' };
    const paths = schemaToVariablePaths(schema);
    expect(paths).toEqual([]);
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
                c: { type: 'string', description: 'Deep value' },
              },
            },
          },
        },
      },
    };

    const paths = schemaToVariablePaths(schema);

    expect(paths).toContainEqual({ path: 'a', type: 'object', description: undefined });
    expect(paths).toContainEqual({ path: 'a.b', type: 'object', description: undefined });
    expect(paths).toContainEqual({ path: 'a.b.c', type: 'string', description: 'Deep value' });
  });
});
