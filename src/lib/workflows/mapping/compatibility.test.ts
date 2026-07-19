import { describe, it, expect } from 'vitest';
import { edgeCompatibility, validateWorkflowCompatibility, heuristicMapping, primaryDataPath } from './compatibility';
import type { MappingContext } from './types';

describe('edgeCompatibility', () => {
  it('is DIRECT when kinds overlap (api-call json → database any)', () => {
    const r = edgeCompatibility('api-call', 'database');
    expect(r.kindMatch).toBe(true);
    expect(r.level).toBe('direct');
  });

  it('is INCOMPATIBLE when kinds do not overlap (trigger signal → llm-call text/json)', () => {
    const r = edgeCompatibility('trigger', 'llm-call');
    expect(r.kindMatch).toBe(false);
    expect(r.level).toBe('incompatible');
    expect(r.reasons[0]).toContain('trigger-signal');
  });

  it('is UNKNOWN (no warning) when a node type has no declared handles', () => {
    const r = edgeCompatibility('api-call', 'not-a-real-node-type');
    expect(r.level).toBe('unknown');
    expect(r.kindMatch).toBe(true);
  });
});

describe('validateWorkflowCompatibility', () => {
  const nodes = [
    { id: 'a', type: 'api-call' },
    { id: 'b', type: 'database' },
    { id: 't', type: 'trigger' },
    { id: 'l', type: 'llm-call' },
  ];

  it('returns no issues for a compatible edge', () => {
    expect(validateWorkflowCompatibility(nodes, [{ sourceNodeId: 'a', targetNodeId: 'b' }])).toEqual([]);
  });

  it('warns (never errors) on an incompatible edge, anchored to the target', () => {
    const issues = validateWorkflowCompatibility(nodes, [{ sourceNodeId: 't', targetNodeId: 'l' }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].targetNodeId).toBe('l');
  });

  it('skips edges that reference unknown node ids', () => {
    expect(validateWorkflowCompatibility(nodes, [{ sourceNodeId: 'a', targetNodeId: 'ghost' }])).toEqual([]);
  });
});

describe('primaryDataPath', () => {
  it('prefers a well-known data path', () => {
    expect(primaryDataPath(['status', 'json', 'url'])).toBe('json');
  });
  it('falls back to the first top-level path', () => {
    expect(primaryDataPath(['foo.bar', 'baz'])).toBe('baz');
  });
});

describe('heuristicMapping', () => {
  const base: MappingContext = {
    sourceType: 'api-call',
    targetType: 'database',
    sourceLabel: 'Companies House',
    targetLabel: 'Database',
    targetConfig: {},
    targetConfigKeys: ['operation', 'collection', 'key', 'data'],
    availablePaths: ['json', 'json.company_number', 'status'],
  };

  it('fills a database target with upsert + derived collection + data + key', () => {
    const r = heuristicMapping(base);
    expect(r.configPatch.operation).toBe('upsert');
    expect(r.configPatch.collection).toBe('companies-house');
    expect(r.configPatch.data).toBe('{{input.json}}');
    expect(r.configPatch.key).toBe('{{input.json.company_number}}');
    expect(r.actions.every((a) => a.kind === 'set-config')).toBe(true);
  });

  it('does not overwrite fields that already have a value', () => {
    const r = heuristicMapping({ ...base, targetConfig: { operation: 'query', collection: 'mine' } });
    expect(r.configPatch.operation).toBeUndefined();
    expect(r.configPatch.collection).toBeUndefined();
    // data was still empty → still proposed
    expect(r.configPatch.data).toBe('{{input.json}}');
  });

  it('fills the first content-ish field for a generic (non-database) target', () => {
    const r = heuristicMapping({
      ...base,
      targetType: 'whatsapp',
      targetLabel: 'WhatsApp',
      targetConfigKeys: ['to', 'message'],
      availablePaths: ['text'],
    });
    expect(r.configPatch.message).toBe('{{input.text}}');
  });

  it('returns a low-confidence empty mapping when nothing matches', () => {
    const r = heuristicMapping({
      ...base,
      targetType: 'delay',
      targetConfigKeys: ['seconds'],
      availablePaths: [],
    });
    expect(r.actions).toHaveLength(0);
    expect(r.confidence).toBeLessThan(0.2);
  });
});
