import { describe, it, expect } from 'vitest';
import { parseLooseJson, unknownRefs, sanitizeActions } from './sanitize';

describe('parseLooseJson', () => {
  it('parses a bare JSON object', () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses JSON wrapped in a code fence + prose', () => {
    expect(parseLooseJson('Here you go:\n```json\n{"a":2}\n```\nHope that helps')).toEqual({ a: 2 });
  });
  it('returns null for non-object / garbage', () => {
    expect(parseLooseJson('not json')).toBeNull();
    expect(parseLooseJson('[1,2,3]')).toBeNull();
    expect(parseLooseJson('')).toBeNull();
  });
});

describe('unknownRefs', () => {
  const known = new Set(['json', 'json.id', 'text']);
  it('is false when every {{input.*}} ref is known (path or root)', () => {
    expect(unknownRefs('{{input.json}}', known)).toBe(false);
    expect(unknownRefs('{{input.json.id}}', known)).toBe(false);
    expect(unknownRefs('{{input.json.deeply.nested}}', known)).toBe(false); // root "json" is known
  });
  it('is true when a ref names an unknown root', () => {
    expect(unknownRefs('{{input.nope}}', known)).toBe(true);
  });
  it('is false for non-strings and literals', () => {
    expect(unknownRefs(42, known)).toBe(false);
    expect(unknownRefs('a literal', known)).toBe(false);
  });
});

describe('sanitizeActions', () => {
  const targetKeys = ['operation', 'collection', 'data'];
  const paths = ['json', 'json.id'];

  it('keeps set-config on known keys and builds the merged patch', () => {
    const { actions, configPatch } = sanitizeActions(
      [
        { kind: 'set-config', field: 'operation', value: 'upsert', label: 'Upsert' },
        { kind: 'set-config', field: 'data', value: '{{input.json}}' },
      ],
      targetKeys,
      paths,
    );
    expect(configPatch).toEqual({ operation: 'upsert', data: '{{input.json}}' });
    expect(actions).toHaveLength(2);
  });

  it('DROPS set-config that targets an unknown config key', () => {
    const { actions, configPatch } = sanitizeActions(
      [
        { kind: 'set-config', field: 'evilKey', value: 'x' },
        { kind: 'set-config', field: 'collection', value: 'notes' },
      ],
      targetKeys,
      paths,
    );
    expect(configPatch).toEqual({ collection: 'notes' });
    expect(actions).toHaveLength(1);
    expect(actions[0].field).toBe('collection');
  });

  it('flags a set-config value that references an unknown upstream path', () => {
    const { actions } = sanitizeActions(
      [{ kind: 'set-config', field: 'data', value: '{{input.ghost}}' }],
      targetKeys,
      paths,
    );
    expect(actions[0].unverifiedRef).toBe(true);
  });

  it('downgrades an unknown insert-node type to an advisory note', () => {
    const { actions, configPatch } = sanitizeActions(
      [{ kind: 'insert-node', nodeType: 'delete-everything', label: 'do it' }],
      targetKeys,
      paths,
    );
    expect(actions[0].kind).toBe('note');
    expect(configPatch).toEqual({});
  });

  it('keeps a known-safe insert-node type as insert-node', () => {
    const { actions } = sanitizeActions(
      [{ kind: 'insert-node', nodeType: 'transform', label: 'bridge' }],
      targetKeys,
      paths,
    );
    expect(actions[0].kind).toBe('insert-node');
    expect(actions[0].nodeType).toBe('transform');
  });

  it('ignores non-array / junk input', () => {
    expect(sanitizeActions('nope', targetKeys, paths)).toEqual({ actions: [], configPatch: {} });
    expect(sanitizeActions([null, 3, {}], targetKeys, paths)).toEqual({ actions: [], configPatch: {} });
  });
});
