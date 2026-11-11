import { beforeEach, describe, expect, it, vi } from 'vitest';

// `deliverRunToSubscribers` against a table kept as a list. The point is the
// restart: the in-memory "already fanned out" set is empty again and the tail
// re-reads the last few minutes, so the same finished run arrives twice. The
// table has no unique key on (build, workflow, run); the read before the
// insert is what stops the second copy. Fixtures are synthetic.

const h = vi.hoisted(() => ({
  subs: [] as Array<{ buildId: string }>,
  builds: new Map<string, { id: string; status: string }>(),
  pending: [] as Array<{ buildId: string; workflowId: string; runId: string; source: string }>,
  failInsertFor: null as string | null,
  tables: {} as Record<string, unknown>,
}));

vi.mock('$lib/db/schema', () => {
  const t = (name: string, cols: string[]) => Object.fromEntries([['__table', name], ...cols.map((c) => [c, { table: name, col: c }])]);
  const tables = {
    buildWorkflowSubscriptions: t('subs', ['buildId', 'workflowId']),
    jkaiBuilds: t('builds', ['id']),
    pendingWorkflowDeliveries: t('pending', ['id', 'buildId', 'workflowId', 'runId', 'consumedAt', 'createdAt']),
    workflowRuns: t('runs', ['id']),
    nodeExecutions: t('execs', ['nodeId', 'status', 'outputData', 'error', 'runId', 'startedAt']),
    workflowNodes: t('nodes', ['id', 'label', 'type']),
  };
  return tables;
});
// Conditions as data, so the list can answer them the way the table would.
vi.mock('drizzle-orm', () => ({
  eq: (col: { col: string }, value: unknown) => ({ op: 'eq', col: col.col, value }),
  inArray: (col: { col: string }, values: unknown[]) => ({ op: 'in', col: col.col, values }),
  and: (...conds: unknown[]) => ({ op: 'and', conds }),
  isNull: (col: { col: string }) => ({ op: 'null', col: col.col }),
  asc: (c: unknown) => c,
  desc: (c: unknown) => c,
}));
vi.mock('$lib/workflows-client/event-bus', () => ({ on: () => () => {} }));
vi.mock('$lib/db', () => {
  type Cond = { op: string; col?: string; value?: unknown; values?: unknown[]; conds?: Cond[] };
  const test = (row: Record<string, unknown>, c: Cond | undefined): boolean =>
    !c ? true
    : c.op === 'and' ? c.conds!.every((x) => test(row, x))
    : c.op === 'eq' ? row[c.col!] === c.value
    : c.op === 'in' ? c.values!.includes(row[c.col!])
    : row[c.col!] == null;
  const rowsOf = (table: { __table: string }): Array<Record<string, unknown>> =>
    table.__table === 'subs' ? h.subs.map((s) => ({ ...s, workflowId: 'wf_1' }))
    : table.__table === 'builds' ? [...h.builds.values()]
    : table.__table === 'pending' ? h.pending
    : table.__table === 'runs' ? [{ id: 'run_1', status: 'completed' }]
    : [];
  const query = (table: { __table: string }) => {
    let cond: Cond | undefined;
    const q = {
      leftJoin: () => q,
      where: (c: Cond) => { cond = c; return q; },
      orderBy: () => q,
      limit: () => q,
      then: (ok: (rows: unknown[]) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve(rowsOf(table).filter((r) => test(r, cond))).then(ok, bad),
    };
    return q;
  };
  return {
    db: {
      select: () => ({ from: (table: { __table: string }) => query(table) }),
      insert: () => ({
        values: async (v: { buildId: string; workflowId: string; runId: string; source: string }) => {
          if (h.failInsertFor === v.buildId) throw new Error('table away');
          h.pending.push({ buildId: v.buildId, workflowId: v.workflowId, runId: v.runId, source: v.source });
        },
      }),
    },
  };
});

const { deliverRunToSubscribers, deliverCompletionOnce, resetDeliveredCompletions } = await import('./workflow-deliveries');

beforeEach(() => {
  h.subs = [{ buildId: 'b1' }, { buildId: 'b2' }];
  h.builds = new Map([['b1', { id: 'b1', status: 'running' }], ['b2', { id: 'b2', status: 'running' }]]);
  h.pending = [];
  h.failInsertFor = null;
  resetDeliveredCompletions();
});

const held = () => h.pending.map((p) => `${p.buildId}:${p.runId}:${p.source}`);

describe('deliverRunToSubscribers', () => {
  it('gives each subscribed build the run once', async () => {
    expect(await deliverRunToSubscribers('wf_1', 'run_1', 'subscription')).toBe(2);
    expect(held()).toEqual(['b1:run_1:subscription', 'b2:run_1:subscription']);
  });

  it('inserts nothing the second time the same run is heard, as after a restart', async () => {
    await deliverCompletionOnce('wf_1', 'run_1');
    // The restart: the remembered keys are gone and the tail reads the row again.
    resetDeliveredCompletions();
    await deliverCompletionOnce('wf_1', 'run_1');
    expect(await deliverRunToSubscribers('wf_1', 'run_1', 'subscription')).toBe(0);
    expect(held()).toEqual(['b1:run_1:subscription', 'b2:run_1:subscription']);
  });

  it('a retry after a half-finished fan-out serves only the builds it missed', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.failInsertFor = 'b2';
    expect(await deliverCompletionOnce('wf_1', 'run_1')).toBe(false);
    expect(held()).toEqual(['b1:run_1:subscription']);
    h.failInsertFor = null;
    expect(await deliverCompletionOnce('wf_1', 'run_1')).toBe(true);
    expect(held()).toEqual(['b1:run_1:subscription', 'b2:run_1:subscription']);
    errors.mockRestore();
  });

  it('a different run of the same workflow is still delivered, and one subscriber listed twice gets one copy', async () => {
    await deliverRunToSubscribers('wf_1', 'run_1', 'subscription');
    h.subs = [{ buildId: 'b1' }, { buildId: 'b1' }];
    expect(await deliverRunToSubscribers('wf_1', 'run_2', 'subscription')).toBe(1);
    expect(held()).toContain('b1:run_2:subscription');
  });

  it('skips a finished build, and a manual delivery is never skipped', async () => {
    h.builds.set('b2', { id: 'b2', status: 'completed' });
    expect(await deliverRunToSubscribers('wf_1', 'run_1', 'subscription')).toBe(1);
    expect(await deliverRunToSubscribers('wf_1', 'run_1', 'manual')).toBe(1);
    expect(held()).toEqual(['b1:run_1:subscription', 'b1:run_1:manual']);
  });
});
