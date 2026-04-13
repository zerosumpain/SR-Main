import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  saveDynamicNode,
  loadDynamicNodeDefinitions,
  validateExecutorSyntax,
} from '$lib/workflows/orchestrator/dynamic-nodes';

const TEST_DIR = join(tmpdir(), 'test-workflow-nodes-' + Date.now());

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

const validDefinition = {
  type: 'test-node',
  label: 'Test Node',
  category: 'integration' as const,
  description: 'A test node for unit tests',
  configSchema: { type: 'object', properties: { url: { type: 'string' } } },
  defaultConfig: { url: '' },
  inputs: [{ name: 'input', type: 'object' as const }],
  outputs: [{ name: 'output', type: 'object' as const }],
};

const validExecutorCode = `export async function execute(input, config, context) {
  return { output: { success: true }, logs: ['done'] };
}`;

describe('validateExecutorSyntax', () => {
  it('accepts valid JS', () => {
    const result = validateExecutorSyntax(validExecutorCode);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid JS', () => {
    const result = validateExecutorSyntax('export async function execute( { return }');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('saveDynamicNode', () => {
  it('writes definition.json and executor.js to the node directory', () => {
    saveDynamicNode(TEST_DIR, validDefinition, validExecutorCode);

    const nodeDir = join(TEST_DIR, 'test-node');
    expect(existsSync(join(nodeDir, 'definition.json'))).toBe(true);
    expect(existsSync(join(nodeDir, 'executor.js'))).toBe(true);

    const def = JSON.parse(readFileSync(join(nodeDir, 'definition.json'), 'utf-8'));
    expect(def.type).toBe('test-node');
    expect(def.label).toBe('Test Node');
  });

  it('overwrites an existing node', () => {
    saveDynamicNode(TEST_DIR, validDefinition, validExecutorCode);
    const updatedDef = { ...validDefinition, label: 'Updated Test Node' };
    saveDynamicNode(TEST_DIR, updatedDef, validExecutorCode);

    const def = JSON.parse(readFileSync(join(TEST_DIR, 'test-node', 'definition.json'), 'utf-8'));
    expect(def.label).toBe('Updated Test Node');
  });
});

describe('loadDynamicNodeDefinitions', () => {
  it('loads definitions from all subdirectories', () => {
    saveDynamicNode(TEST_DIR, validDefinition, validExecutorCode);
    saveDynamicNode(TEST_DIR, { ...validDefinition, type: 'another-node', label: 'Another' }, validExecutorCode);

    const defs = loadDynamicNodeDefinitions(TEST_DIR);
    expect(defs).toHaveLength(2);
    expect(defs.map(d => d.type).sort()).toEqual(['another-node', 'test-node']);
  });

  it('returns empty array for non-existent directory', () => {
    const defs = loadDynamicNodeDefinitions('/tmp/nonexistent-xyz-12345');
    expect(defs).toHaveLength(0);
  });

  it('skips directories with invalid definition.json', () => {
    mkdirSync(join(TEST_DIR, 'bad-node'), { recursive: true });
    writeFileSync(join(TEST_DIR, 'bad-node', 'definition.json'), 'not json');
    writeFileSync(join(TEST_DIR, 'bad-node', 'executor.js'), validExecutorCode);

    saveDynamicNode(TEST_DIR, validDefinition, validExecutorCode);

    const defs = loadDynamicNodeDefinitions(TEST_DIR);
    expect(defs).toHaveLength(1);
    expect(defs[0].type).toBe('test-node');
  });
});
