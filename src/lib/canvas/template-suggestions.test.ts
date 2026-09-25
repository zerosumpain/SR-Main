import { describe, it, expect } from 'vitest';
import { computeTemplateSuggestions, templateCandidates, filterTemplateCandidates } from './upstream-fields';

describe('computeTemplateSuggestions', () => {
  const nodes = [
    { id: 't', name: 'Start', outputData: { who: 'john' } },
    { id: 'a', name: 'Get Accounts', outputData: { json: { results: [{ id: 1 }] } } },
    { id: 'b', name: 'Get Cards', outputData: { json: { total: 2 } } },
    { id: 'c', name: 'Sum' },
  ];
  const edges = [
    { sourceNodeId: 't', targetNodeId: 'a' },
    { sourceNodeId: 't', targetNodeId: 'b' },
    { sourceNodeId: 'a', targetNodeId: 'c' },
    { sourceNodeId: 'b', targetNodeId: 'c' },
  ];

  it('offers the merged view, each upstream by label slug, and the trigger', () => {
    const s = computeTemplateSuggestions('c', nodes, edges, ['declared.path']);
    expect(s).toContain('input.json');
    expect(s).toContain('input.declared.path');
    expect(s).toContain('nodes.get-accounts.json.results.0.id');
    expect(s).toContain('nodes.get-cards.json.total');
    expect(s).toContain('nodes.start.who');
    expect(s).toContain('trigger.who');
    expect(s.some((x) => x.startsWith('nodes.sum'))).toBe(false);
  });
});

describe('templateCandidates / filterTemplateCandidates', () => {
  it('prefixes bare run-data paths with input. and keeps namespaced entries', () => {
    expect(templateCandidates(['body.x', 'input.y'], ['nodes.a.z', 'trigger.w'])).toEqual(['input.body.x', 'input.y', 'nodes.a.z', 'trigger.w']);
  });
  it('filters on what was typed after {{, ignoring a typed input. prefix', () => {
    const c = ['input.query', 'nodes.fetch.query', 'input.other'];
    expect(filterTemplateCandidates(c, 'input.que')).toEqual(['input.query', 'nodes.fetch.query']);
    expect(filterTemplateCandidates(c, 'nodes.')).toEqual(['nodes.fetch.query']);
  });
});
