// tests/lib/jkai/intel/cascade-delete.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Call = { op: string; table: string };
const calls: Call[] = [];

/**
 * Fake tx. Selects are served from a queue, in the order deleteNoteCascade
 * issues them:
 *
 *   1. entities linked to this note                     → `candidates`
 *   2. those same entities linked to a DIFFERENT note   → `linkedElsewhere`
 *   3. merge tombstones pointing at the doomed set      → `aliases` (repeats
 *      until it comes back empty — the fixpoint walk)
 *   4. every insight, matched in JS against the doomed set
 *
 * `from()` is both awaitable and chainable, because step 4 selects a whole
 * table with no `where`.
 */
function makeTx(queue: unknown[][]) {
  let index = 0;
  const next = () => queue[index++] ?? [];
  return {
    select: () => ({
      from: (_table: unknown) => {
        const result = {
          where: async (_cond: unknown) => next(),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(next()).then(resolve),
        };
        return result;
      },
    }),
    delete: (table: { _name?: string }) => ({
      where: async (_cond: unknown) => {
        calls.push({ op: 'delete', table: table._name ?? 'unknown' });
        return { rowCount: 1 };
      },
    }),
  };
}

const withTx = (queue: unknown[][]) => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(makeTx(queue)),
  },
});

vi.mock('$lib/db/schema', () => ({
  intelNotes: { _name: 'intel_notes' },
  intelEntities: { _name: 'intel_entities' },
  intelRelationships: { _name: 'intel_relationships' },
  intelNoteEntities: { _name: 'intel_note_entities' },
  intelTimelineEvents: { _name: 'intel_timeline_events' },
  intelDossierItems: { _name: 'intel_dossier_items' },
  intelInsights: { _name: 'intel_insights' },
}));

vi.mock('$lib/db', () => withTx([]));

beforeEach(() => {
  calls.length = 0;
  vi.resetModules();
});

const entityRows = (ids: string[]) => ids.map((id) => ({ entityId: id }));
const idRows = (ids: string[]) => ids.map((id) => ({ id }));

describe('deleteNoteCascade', () => {
  it('deletes relationships, the note, the debris, then the orphan entities — in that order', async () => {
    vi.doMock('$lib/db', () =>
      withTx([
        entityRows(['orphan-1', 'orphan-2']), // candidates
        [], // linked elsewhere
        [], // no merge tombstones
        [], // no insights
      ]),
    );
    const { deleteNoteCascade } = await import('$lib/jkai/intel/ingest');
    const result = await deleteNoteCascade('note-abc');

    expect(calls.map((c) => c.table)).toEqual([
      'intel_relationships',
      'intel_notes',
      'intel_timeline_events',
      'intel_dossier_items',
      'intel_entities',
    ]);
    expect(result).toEqual({
      deleted: true,
      removedRelationships: 1,
      removedEntities: 2,
      removedTimelineEvents: 1,
      removedDossierItems: 1,
      removedInsights: 0,
    });
  });

  it('reports zero orphans when every candidate is linked to another note', async () => {
    vi.doMock('$lib/db', () =>
      withTx([entityRows(['shared-1', 'shared-2']), entityRows(['shared-1', 'shared-2'])]),
    );
    const { deleteNoteCascade } = await import('$lib/jkai/intel/ingest');
    const result = await deleteNoteCascade('note-xyz');
    expect(result.removedEntities).toBe(0);
    expect(calls.map((c) => c.table)).toEqual(['intel_relationships', 'intel_notes']);
  });

  it('reports zero orphans when the note had no entities at all', async () => {
    vi.doMock('$lib/db', () => withTx([[], []]));
    const { deleteNoteCascade } = await import('$lib/jkai/intel/ingest');
    const result = await deleteNoteCascade('note-empty');
    expect(result.removedEntities).toBe(0);
    expect(calls.map((c) => c.table)).toEqual(['intel_relationships', 'intel_notes']);
  });

  // A merged-away row survives every graph view (they all filter
  // `merged_into_id IS NULL`), so leaving it when its survivor is deleted hides
  // it for ever instead of restoring it.
  it('pulls in merge tombstones that pointed at a deleted entity, transitively', async () => {
    vi.doMock('$lib/db', () =>
      withTx([
        entityRows(['survivor']), // candidates
        [], // linked elsewhere
        idRows(['alias-1']), // merged into survivor
        idRows(['alias-2']), // merged into alias-1
        [], // fixpoint reached
        [], // no insights
      ]),
    );
    const { deleteNoteCascade } = await import('$lib/jkai/intel/ingest');
    const result = await deleteNoteCascade('note-merged');
    expect(result.removedEntities).toBe(3);
  });

  it('removes insights that referenced a deleted entity, and leaves the others', async () => {
    vi.doMock('$lib/db', () =>
      withTx([
        entityRows(['gone']), // candidates
        [], // linked elsewhere
        [], // no tombstones
        [
          { id: 'insight-about-gone', entityIds: ['gone', 'other'] },
          { id: 'insight-unrelated', entityIds: ['other'] },
          { id: 'insight-empty', entityIds: [] },
        ],
      ]),
    );
    const { deleteNoteCascade } = await import('$lib/jkai/intel/ingest');
    const result = await deleteNoteCascade('note-insight');
    expect(result.removedInsights).toBe(1);
    expect(calls.map((c) => c.table)).toEqual([
      'intel_relationships',
      'intel_notes',
      'intel_timeline_events',
      'intel_dossier_items',
      'intel_insights',
      'intel_entities',
    ]);
  });

  it('reports removedRelationships: 0 when the driver returns a null rowCount', async () => {
    vi.doMock('$lib/db', () => ({
      db: {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            select: () => ({
              from: (_table: unknown) => ({
                where: async (_cond: unknown) => [],
                then: (resolve: (value: unknown) => unknown) => Promise.resolve([]).then(resolve),
              }),
            }),
            delete: (_table: unknown) => ({
              where: async (_cond: unknown) => ({ rowCount: null }),
            }),
          };
          return cb(tx);
        },
      },
    }));
    const { deleteNoteCascade } = await import('$lib/jkai/intel/ingest');
    const result = await deleteNoteCascade('note-null-driver');
    expect(result.removedRelationships).toBe(0);
    expect(result.removedEntities).toBe(0);
  });
});
