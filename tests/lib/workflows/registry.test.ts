import { describe, it, expect, beforeEach } from 'vitest';
import { NodeRegistry } from '$lib/workflows/registry';
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '$lib/workflows/types';

function makeDummyExecutor(type: string): NodeExecutor {
  return {
    type,
    async execute(): Promise<NodeResult> {
      return { output: {} };
    },
    getInputSchema() {
      return { type: 'object' };
    },
    getOutputSchema() {
      return { type: 'object' };
    },
  };
}

function makeDummyDef(type: string, category: NodeDefinition['category'] = 'core'): NodeDefinition {
  return {
    type,
    label: type,
    category,
    description: `${type} node`,
    configSchema: { type: 'object' },
    defaultConfig: {},
    inputs: [],
    outputs: [{ name: 'output', type: 'any' }],
  };
}

describe('NodeRegistry', () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry();
  });

  it('registers and retrieves a node definition', () => {
    registry.register(makeDummyDef('test'), makeDummyExecutor('test'));
    const def = registry.getDefinition('test');
    expect(def?.type).toBe('test');
  });

  it('retrieves an executor', () => {
    registry.register(makeDummyDef('test'), makeDummyExecutor('test'));
    const executor = registry.getExecutor('test');
    expect(executor?.type).toBe('test');
  });

  it('returns undefined for unknown type', () => {
    expect(registry.getDefinition('nope')).toBeUndefined();
    expect(registry.getExecutor('nope')).toBeUndefined();
  });

  it('lists all definitions', () => {
    registry.register(makeDummyDef('a', 'trigger'), makeDummyExecutor('a'));
    registry.register(makeDummyDef('b', 'core'), makeDummyExecutor('b'));
    const all = registry.listDefinitions();
    expect(all).toHaveLength(2);
  });

  it('lists definitions by category', () => {
    registry.register(makeDummyDef('a', 'trigger'), makeDummyExecutor('a'));
    registry.register(makeDummyDef('b', 'core'), makeDummyExecutor('b'));
    registry.register(makeDummyDef('c', 'core'), makeDummyExecutor('c'));
    const cores = registry.listDefinitions('core');
    expect(cores).toHaveLength(2);
    expect(cores.every((d) => d.category === 'core')).toBe(true);
  });

  it('searches definitions by query', () => {
    registry.register(makeDummyDef('http-request', 'core'), makeDummyExecutor('http-request'));
    registry.register(makeDummyDef('slack-send', 'integration'), makeDummyExecutor('slack-send'));
    registry.register(makeDummyDef('email', 'integration'), makeDummyExecutor('email'));

    const results = registry.search('slack');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('slack-send');
  });

  it('search returns empty for no match', () => {
    registry.register(makeDummyDef('http-request', 'core'), makeDummyExecutor('http-request'));
    const results = registry.search('nonexistent-xyz');
    expect(results).toHaveLength(0);
  });

  it('search filters by category', () => {
    registry.register(makeDummyDef('http-request', 'core'), makeDummyExecutor('http-request'));
    registry.register(makeDummyDef('slack-send', 'integration'), makeDummyExecutor('slack-send'));

    const results = registry.search('request', 'integration');
    expect(results.every(d => d.category === 'integration')).toBe(true);
  });
});
