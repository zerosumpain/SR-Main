import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fixtures + capture buffers the db mock reads/writes.
let rows: any[] = [];
let deletedRows: any[] = [];
const deleteWheres: any[] = [];
const eqCalls: Array<[unknown, unknown]> = [];
const audits: any[] = [];

vi.mock('$lib/db/schema', () => ({
  workflowDataStore: {
    __t: 'workflow_data_store',
    workflowId: 'col:workflowId',
    key: 'col:key',
    value: 'col:value',
    updatedAt: 'col:updatedAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...a: any[]) => ({ __and: a }),
  eq: (col: any, val: any) => {
    eqCalls.push([col, val]);
    return { __eq: [col, val] };
  },
}));

vi.mock('$lib/db', () => ({
  db: {
    select: (_proj: any) => ({
      from: (_t: any) => ({
        where: async () => rows,
      }),
    }),
    delete: (_t: any) => ({
      where: (cond: any) => {
        deleteWheres.push(cond);
        return { returning: async () => deletedRows };
      },
    }),
  },
}));

vi.mock('$lib/canvas/audit', () => ({
  MEMORY_CLEAR_ACTOR: 'memory-clear',
  recordAudit: async (input: any) => {
    audits.push(input);
  },
}));

import { GET } from './+server';
import { DELETE } from './[key]/+server';

beforeEach(() => {
  rows = [];
  deletedRows = [];
  deleteWheres.length = 0;
  eqCalls.length = 0;
  audits.length = 0;
});

describe('GET /api/workflows/[id]/data-store — memory listing', () => {
  it('returns 400 when the workflow id is missing', async () => {
    const res = await GET({ params: {} } as any);
    expect(res.status).toBe(400);
  });

  it('summarises each key with value / itemCount / updatedAt (+ backwards-compat meta)', async () => {
    const when = new Date('2026-07-16T09:30:00.000Z');
    rows = [
      { key: 'seen_ids', value: ['a', 'b', 'c'], updatedAt: when },
      { key: 'counter', value: 42, updatedAt: when },
    ];
    const res = await GET({ params: { id: 'wf-1' } } as any);
    const body = await res.json();
    expect(body.keys).toHaveLength(2);

    const seen = body.keys.find((k: any) => k.key === 'seen_ids');
    expect(seen.value).toBe('["a","b","c"]');
    expect(seen.truncated).toBe(false);
    expect(seen.itemCount).toBe(3);
    expect(seen.updatedAt).toBe('2026-07-16T09:30:00.000Z');
    expect(seen.meta).toBe('updated 2026-07-16');

    const counter = body.keys.find((k: any) => k.key === 'counter');
    expect(counter.value).toBe('42');
    expect(counter.itemCount).toBeNull();
  });

  it('truncates large values to ~2KB and flags them', async () => {
    const big = Array.from({ length: 5000 }, (_, i) => i); // JSON >> 2KB
    rows = [{ key: 'big', value: big, updatedAt: new Date('2026-07-16T00:00:00.000Z') }];
    const res = await GET({ params: { id: 'wf-1' } } as any);
    const body = await res.json();
    const entry = body.keys[0];
    expect(entry.truncated).toBe(true);
    expect(entry.value.length).toBe(2048);
    expect(entry.itemCount).toBe(5000);
  });

  it('handles a null updatedAt gracefully', async () => {
    rows = [{ key: 'k', value: { a: 1 }, updatedAt: null }];
    const res = await GET({ params: { id: 'wf-1' } } as any);
    const body = await res.json();
    expect(body.keys[0].updatedAt).toBeNull();
    expect(body.keys[0].meta).toBeUndefined();
  });
});

describe('DELETE /api/workflows/[id]/data-store/[key] — clear one key', () => {
  it('returns 400 when the key is missing', async () => {
    const res = await DELETE({ params: { id: 'wf-1' } } as any);
    expect(res.status).toBe(400);
    expect(deleteWheres).toHaveLength(0);
  });

  it('deletes the row scoped to (workflowId, key) and reports the count', async () => {
    deletedRows = [{ key: 'seen_ids' }];
    const res = await DELETE({ params: { id: 'wf-1', key: 'seen_ids' } } as any);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(1);
    expect(deleteWheres).toHaveLength(1);
    // Both the workflowId and the key must be part of the filter — proves the
    // clear is scoped and can't wipe another workflow's key.
    expect(eqCalls).toContainEqual(['col:workflowId', 'wf-1']);
    expect(eqCalls).toContainEqual(['col:key', 'seen_ids']);
  });

  it('reports deleted: 0 when the key was never stored', async () => {
    const res = await DELETE({ params: { id: 'wf-1', key: 'never_written' } } as any);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(0);
  });

  it('audits the clear against the workflow, tagged so the doctor can skip it', async () => {
    deletedRows = [{ key: '_wa_sent_hashes' }];
    await DELETE({ params: { id: 'wf-1', key: '_wa_sent_hashes' } } as any);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      workflowId: 'wf-1',
      entity: 'workflow',
      action: 'update',
      // Literal on purpose: this string is the wire value the Workflow Doctor's
      // quiet-window SQL matches on, and rows already in the table carry it.
      details: { clearedMemoryKey: '_wa_sent_hashes', deleted: 1, actor: 'memory-clear' },
    });
  });

  it('does not audit a rejected request', async () => {
    await DELETE({ params: { id: 'wf-1' } } as any);
    expect(audits).toHaveLength(0);
  });
});
