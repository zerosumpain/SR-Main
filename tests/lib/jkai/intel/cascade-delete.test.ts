// tests/lib/jkai/intel/cascade-delete.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Call = { op: string; table: string };
const calls: Call[] = [];

// Fake tx:
// - The 1st select().from().where(...) returns `candidates` — entities
//   linked to this note.
// - The 2nd select().from().where(...) returns `linkedElsewhere` — same
//   entities linked to *other* notes. Anything in `candidates` but NOT in
//   `linkedElsewhere` is an orphan.
// - delete().where(...) records the table touched and returns `{ rowCount: 1 }`.
function makeTx(candidates: string[], linkedElsewhere: string[]) {
  const selectResults = [
    candidates.map((id) => ({ entityId: id })),
    linkedElsewhere.map((id) => ({ entityId: id })),
  ];
  let selectIndex = 0;
  return {
    select: () => ({
      from: (_table: unknown) => ({
        where: async (_cond: unknown) => selectResults[selectIndex++] ?? [],
      }),
    }),
    delete: (table: { _name?: string }) => ({
      where: async (_cond: unknown) => {
        calls.push({ op: 'delete', table: table._name ?? 'unknown' });
        return { rowCount: 1 };
      },
    }),
  };
}

vi.mock('$lib/db/schema', () => ({
  intelNotes: { _name: 'intel_notes' },
  intelEntities: { _name: 'intel_entities' },
  intelRelationships: { _name: 'intel_relationships' },
  intelNoteEntities: { _name: 'intel_note_entities' },
}));

// Default mock: 2 candidates, 0 linked elsewhere → both are orphans.
vi.mock('$lib/db', () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(makeTx(['orphan-1', 'orphan-2'], [])),
  },
}));

beforeEach(() => {
  calls.length = 0;
  vi.resetModules();
});

describe('deleteNoteCascade', () => {
  it('deletes relationships, then the note, then orphan entities — in that order', async () => {
    vi.doMock('$lib/db', () => ({
      db: {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
          cb(makeTx(['orphan-1', 'orphan-2'], [])),
      },
    }));
    const { deleteNoteCascade } = await import('$lib/jkai/intel/ingest');
    const result = await deleteNoteCascade('note-abc');

    expect(calls.map((c) => c.table)).toEqual([
      'intel_relationships',
      'intel_notes',
      'intel_entities',
    ]);
    expect(result).toEqual({
      deleted: true,
      removedRelationships: 1,
      removedEntities: 2,
    });
  });

  it('reports zero orphans when every candidate is linked to another note', async () => {
    vi.doMock('$lib/db', () => ({
      db: {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
          cb(makeTx(['shared-1', 'shared-2'], ['shared-1', 'shared-2'])),
      },
    }));
    const { deleteNoteCascade } = await import('$lib/jkai/intel/ingest');
    const result = await deleteNoteCascade('note-xyz');
    expect(result.removedEntities).toBe(0);
    expect(calls.map((c) => c.table)).toEqual(['intel_relationships', 'intel_notes']);
  });

  it('reports zero orphans when the note had no entities at all', async () => {
    vi.doMock('$lib/db', () => ({
      db: {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
          cb(makeTx([], [])),
      },
    }));
    const { deleteNoteCascade } = await import('$lib/jkai/intel/ingest');
    const result = await deleteNoteCascade('note-empty');
    expect(result.removedEntities).toBe(0);
    expect(calls.map((c) => c.table)).toEqual(['intel_relationships', 'intel_notes']);
  });
});
