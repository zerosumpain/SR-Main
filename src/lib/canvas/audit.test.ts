import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * When an audit row is written inside somebody's transaction, the observability
 * event it raises must wait for the commit.
 *
 * `emitObs` goes straight out to every open SSE listener. Emitted from inside a
 * transaction it announces an edit that a later failing op can still roll back,
 * and an announcement cannot be rolled back — a dashboard would show an edit
 * that never happened, with no correction behind it.
 */

const h = vi.hoisted(() => ({
  /** `.values()` payloads, so a test can tell a write from a no-op. */
  inserted: [] as unknown[],
  /** true → the INSERT throws, as a dead transaction's would. */
  failInsert: false,
}));

vi.mock('$lib/db', () => {
  const conn = () => ({
    insert: () => ({
      values: async (values: unknown) => {
        if (h.failInsert) throw new Error('insert failed');
        h.inserted.push(values);
      },
    }),
  });
  return { db: conn() };
});

vi.mock('$lib/workflows/observability-bus', () => ({ emitObs: vi.fn() }));

import { emitObs } from '$lib/workflows/observability-bus';
import type { DbExecutor } from '$lib/db';
import { recordAudit, recordAuditBatch, flushAuditObs, discardAuditObs } from './audit';

/** Stands in for the handle `db.transaction()` passes its callback. */
function makeTx(): DbExecutor {
  return {
    insert: () => ({
      values: async (values: unknown) => {
        if (h.failInsert) throw new Error('insert failed');
        h.inserted.push(values);
      },
    }),
  } as unknown as DbExecutor;
}

const entry = { workflowId: 'w1', entity: 'node' as const, entityId: 'n1', action: 'config' as const };

beforeEach(() => {
  h.inserted = [];
  h.failInsert = false;
  vi.mocked(emitObs).mockClear();
});

describe('recordAudit', () => {
  it('emits straight away when it writes on the pool', async () => {
    await recordAudit(entry);
    expect(h.inserted).toHaveLength(1);
    expect(emitObs).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitObs).mock.calls[0][0]).toBe('audit.edit');
  });

  it('holds the event back until the caller flushes its transaction', async () => {
    const tx = makeTx();
    await recordAudit(entry, tx);

    expect(h.inserted).toHaveLength(1);
    expect(emitObs).not.toHaveBeenCalled();

    flushAuditObs(tx);
    expect(emitObs).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitObs).mock.calls[0][1]).toMatchObject({
      workflowId: 'w1',
      entity: 'node',
      action: 'config',
    });
  });

  it('emits nothing when the transaction is discarded', async () => {
    const tx = makeTx();
    await recordAudit(entry, tx);
    discardAuditObs(tx);
    flushAuditObs(tx);
    expect(emitObs).not.toHaveBeenCalled();
  });

  it('does not replay on a second flush', async () => {
    const tx = makeTx();
    await recordAudit(entry, tx);
    flushAuditObs(tx);
    flushAuditObs(tx);
    expect(emitObs).toHaveBeenCalledTimes(1);
  });

  it('still swallows a pool write failure, and still throws inside a transaction', async () => {
    h.failInsert = true;
    await expect(recordAudit(entry)).resolves.toBeUndefined();
    await expect(recordAudit(entry, makeTx())).rejects.toThrow('insert failed');
    expect(emitObs).not.toHaveBeenCalled();
  });
});

describe('recordAuditBatch', () => {
  it('holds one event per entry until the flush', async () => {
    const tx = makeTx();
    await recordAuditBatch(
      [entry, { ...entry, entity: 'edge', entityId: 'e1', action: 'create' }],
      tx,
    );

    expect(emitObs).not.toHaveBeenCalled();
    flushAuditObs(tx);
    expect(emitObs).toHaveBeenCalledTimes(2);
  });
});
