import { describe, it, expect } from 'vitest';
import { resolvePermissions, assertCan, canDo } from './permissions';
import { DatastoreError } from './types';
import type { DatastoreRecord, DatastoreCollection } from './types';

function mkCollection(over: Partial<DatastoreCollection> = {}): DatastoreCollection {
  return {
    id: 'c1',
    slug: 'notes',
    name: null,
    description: null,
    schema: null,
    defaultPermissions: null,
    settings: null,
    isSystem: false,
    createdBy: 'owner',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}
function mkRecord(over: Partial<DatastoreRecord> = {}): DatastoreRecord {
  return {
    id: 'r1',
    collectionId: 'c1',
    key: null,
    data: {},
    permissions: null,
    version: 1,
    createdBy: 'jkai',
    updatedBy: 'jkai',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    ...over,
  };
}

describe('resolvePermissions', () => {
  it('uses the record permissions when set (record overrides collection)', () => {
    const rec = mkRecord({ permissions: { read: ['owner'], write: ['owner'], delete: ['owner'] } });
    const col = mkCollection({ defaultPermissions: { read: ['*'], write: ['*'], delete: ['*'] } });
    const p = resolvePermissions(rec, col);
    expect(p.read).toEqual(['owner']);
    expect(p.write).toEqual(['owner']);
  });

  it('falls back to collection defaultPermissions when the record has none', () => {
    const rec = mkRecord({ permissions: null });
    const col = mkCollection({ defaultPermissions: { read: ['jkai'], write: ['jkai'], delete: ['jkai'] } });
    const p = resolvePermissions(rec, col);
    expect(p.read).toEqual(['jkai']);
  });

  it('falls back to the built-in creator default {creator, owner, jkai}', () => {
    const rec = mkRecord({ permissions: null, createdBy: 'workflow:abc' });
    const col = mkCollection({ defaultPermissions: null });
    const p = resolvePermissions(rec, col);
    expect(p.read).toEqual(['workflow:abc', 'owner', 'jkai']);
    expect(p.write).toEqual(['workflow:abc', 'owner', 'jkai']);
    expect(p.delete).toEqual(['workflow:abc', 'owner', 'jkai']);
  });

  it('dedupes the built-in default when the creator is owner or jkai', () => {
    const rec = mkRecord({ permissions: null, createdBy: 'owner' });
    const col = mkCollection({ defaultPermissions: null });
    const p = resolvePermissions(rec, col);
    expect(p.read).toEqual(['owner', 'jkai']);
  });

  it('fills a missing action key from the built-in default', () => {
    const rec = mkRecord({ permissions: { read: ['*'] }, createdBy: 'owner' });
    const col = mkCollection({ defaultPermissions: null });
    const p = resolvePermissions(rec, col);
    expect(p.read).toEqual(['*']);
    // write/delete were absent → built-in creator default
    expect(p.write).toEqual(['owner', 'jkai']);
    expect(p.delete).toEqual(['owner', 'jkai']);
  });
});

describe('assertCan / canDo', () => {
  const perms = { read: ['jkai', 'workflow:*'], write: ['workflow:abc'], delete: ['owner'] };

  it('owner always passes every action, even when not listed', () => {
    expect(() => assertCan('read', { read: [], write: [], delete: [] }, 'owner')).not.toThrow();
    expect(() => assertCan('delete', { read: [], write: [], delete: [] }, 'owner')).not.toThrow();
    expect(canDo('write', { read: [], write: [], delete: [] }, 'owner')).toBe(true);
  });

  it('matches a concrete actor listed explicitly', () => {
    expect(canDo('read', perms, 'jkai')).toBe(true);
  });

  it('workflow:* wildcard matches any workflow:<id> actor', () => {
    expect(canDo('read', perms, 'workflow:xyz')).toBe(true);
    expect(canDo('read', perms, 'workflow:anything')).toBe(true);
  });

  it('workflow:* does NOT match a non-workflow actor', () => {
    expect(canDo('read', perms, 'system')).toBe(false);
  });

  it('the * wildcard matches everyone', () => {
    expect(canDo('read', { read: ['*'], write: [], delete: [] }, 'system')).toBe(true);
    expect(canDo('read', { read: ['*'], write: [], delete: [] }, 'workflow:z')).toBe(true);
  });

  it('denies by default (actor not present)', () => {
    expect(canDo('write', perms, 'jkai')).toBe(false);
    expect(() => assertCan('write', perms, 'jkai')).toThrow(DatastoreError);
    try {
      assertCan('write', perms, 'jkai');
    } catch (e) {
      expect((e as DatastoreError).code).toBe('forbidden');
    }
  });

  it('allows a specific workflow id via an exact list entry', () => {
    expect(canDo('write', perms, 'workflow:abc')).toBe(true);
    expect(canDo('write', perms, 'workflow:def')).toBe(false);
  });
});
