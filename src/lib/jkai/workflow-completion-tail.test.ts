import { beforeEach, describe, expect, it, vi } from 'vitest';

// The cursor and the once-only delivery, with the table as a list. Nothing
// here reaches a database: the tail's read and the fan-out are both handed in.
vi.mock('$lib/db', () => ({ db: {} }));

const { createCompletionTail, TAIL_PAGE, TAIL_OVERLAP_MS, TAIL_START_LOOKBACK_MS } = await import('./workflow-completion-tail');
const { deliverCompletionOnce, resetDeliveredCompletions } = await import('./workflow-deliveries');
type CompletionRow = import('./workflow-completion-tail').CompletionRow;
type TailCursor = import('./workflow-completion-tail').TailCursor;

const START = new Date('2026-11-11T09:00:00.000Z');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** A row `secs` after the start, to the microsecond. */
const row = (n: number, secs: number, micros = 0, over: Partial<CompletionRow> = {}): CompletionRow => ({
  id: uuid(n),
  at: `${new Date(+START + secs * 1000).toISOString().slice(0, 19)}.${String(micros).padStart(6, '0')}Z`,
  workflowId: `wf_${n}`,
  runId: `run_${n}`,
  ...over,
});

const key = (c: { at: string; id: string }) => `${c.at.replace(/Z$/, '').padEnd(26, '0')}|${c.id}`;

/** A table that answers the tail's query the way Postgres would. */
function table(rows: CompletionRow[]) {
  const reads: TailCursor[] = [];
  const read = async (after: TailCursor, limit: number) => {
    reads.push(after);
    return [...rows].sort((a, b) => (key(a) < key(b) ? -1 : 1)).filter((r) => key(r) > key(after)).slice(0, limit);
  };
  return { rows, reads, read };
}

function fanOut() {
  const calls: string[] = [];
  const deliver = async (workflowId: string, runId: string) => {
    await deliverCompletionOnce(workflowId, runId, async (w, r) => {
      calls.push(`${w}:${r}`);
      return 1;
    });
  };
  return { calls, deliver };
}

beforeEach(() => resetDeliveredCompletions());

describe('the workflow.completed tail', () => {
  it('starts a few minutes before process start: a run that finished during the restart is delivered, older history is not', async () => {
    expect(TAIL_START_LOOKBACK_MS).toBe(5 * 60_000);
    // Ten minutes before the start, 30 s before it (the process was down), and after it.
    const t = table([row(1, -600), row(2, -30), row(3, 5)]);
    const out = fanOut();
    const tail = createCompletionTail(START, { read: t.read, deliver: out.deliver });
    expect(await tail.pass()).toBe(2);
    expect(out.calls).toEqual(['wf_2:run_2', 'wf_3:run_3']);
    expect(t.reads[0]).toEqual({ at: new Date(+START - TAIL_START_LOOKBACK_MS).toISOString(), id: '00000000-0000-0000-0000-000000000000' });
  });

  it('with no lookback it starts at process start', async () => {
    const t = table([row(1, -30), row(2, 5)]);
    const out = fanOut();
    const tail = createCompletionTail(START, { read: t.read, deliver: out.deliver }, 0);
    expect(await tail.pass()).toBe(1);
    expect(out.calls).toEqual(['wf_2:run_2']);
  });

  it('tries a run again on the next pass when its fan-out failed', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = table([row(1, 5)]);
    const calls: string[] = [];
    let fail = true;
    const tail = createCompletionTail(START, {
      read: t.read,
      deliver: (w, r) => deliverCompletionOnce(w, r, async () => { calls.push(r); if (fail) throw new Error('subscriber table away'); return 1; }),
    });
    await tail.pass();
    fail = false;
    await tail.pass();
    await tail.pass();
    expect(calls).toEqual(['run_1', 'run_1']);
    errors.mockRestore();
  });

  it('delivers each run once across passes, though every pass re-reads the overlap', async () => {
    const t = table([row(1, 5), row(2, 6)]);
    const out = fanOut();
    const tail = createCompletionTail(START, { read: t.read, deliver: out.deliver });
    await tail.pass();
    t.rows.push(row(3, 20));
    await tail.pass();
    await tail.pass();
    expect(out.calls).toEqual(['wf_1:run_1', 'wf_2:run_2', 'wf_3:run_3']);
    expect(tail.cursor()).toEqual({ at: row(3, 20).at, id: uuid(3) });
  });

  it('picks up a row that became visible behind the cursor', async () => {
    const t = table([row(2, 30)]);
    const out = fanOut();
    const tail = createCompletionTail(START, { read: t.read, deliver: out.deliver });
    await tail.pass();
    // Stamped earlier, committed later.
    t.rows.push(row(1, 25));
    await tail.pass();
    expect(out.calls).toEqual(['wf_2:run_2', 'wf_1:run_1']);
    // The cursor never moves backwards for it.
    expect(tail.cursor().id).toBe(uuid(2));
  });

  it('looks back no further than the overlap, and never before where it began', async () => {
    const t = table([row(1, 10), row(2, 600)]);
    const tail = createCompletionTail(START, { read: t.read, deliver: fanOut().deliver });
    await tail.pass();
    await tail.pass();
    expect(Date.parse(t.reads[0].at)).toBe(+START - TAIL_START_LOOKBACK_MS);
    expect(Date.parse(t.reads.at(-1)!.at)).toBe(+START + 600_000 - TAIL_OVERLAP_MS);
  });

  it('tells apart rows in the same millisecond, by microsecond and then by id', async () => {
    const t = table([row(1, 5, 123456), row(2, 5, 123457), row(4, 5, 123457), row(3, 5, 123999)]);
    const out = fanOut();
    const tail = createCompletionTail(START, { read: t.read, deliver: out.deliver });
    expect(await tail.pass()).toBe(4);
    expect(out.calls).toEqual(['wf_1:run_1', 'wf_2:run_2', 'wf_4:run_4', 'wf_3:run_3']);
    expect(tail.cursor()).toEqual({ at: row(3, 5, 123999).at, id: uuid(3) });
  });

  it('reads on through a full page in the same pass', async () => {
    const many = Array.from({ length: TAIL_PAGE + 7 }, (_, i) => row(i + 1, 5 + i));
    const t = table(many);
    const out = fanOut();
    const tail = createCompletionTail(START, { read: t.read, deliver: out.deliver });
    expect(await tail.pass()).toBe(TAIL_PAGE + 7);
    expect(out.calls).toHaveLength(TAIL_PAGE + 7);
    expect(t.reads).toHaveLength(2);
    expect(t.reads[1]).toEqual({ at: many[TAIL_PAGE - 1].at, id: many[TAIL_PAGE - 1].id });
  });

  it('moves nothing when the read fails, and delivers on the next pass', async () => {
    const t = table([row(1, 5)]);
    const out = fanOut();
    let fail = true;
    const tail = createCompletionTail(START, { read: async (a, l) => { if (fail) throw new Error('database away'); return t.read(a, l); }, deliver: out.deliver });
    await expect(tail.pass()).rejects.toThrow('database away');
    expect(tail.cursor().at).toBe(new Date(+START - TAIL_START_LOOKBACK_MS).toISOString());
    fail = false;
    await tail.pass();
    expect(out.calls).toEqual(['wf_1:run_1']);
  });

  it('passes a row with no run on it, and one whose delivery throws, without stopping', async () => {
    const t = table([row(1, 5, 0, { runId: null }), row(2, 6), row(3, 7)]);
    const seen: string[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tail = createCompletionTail(START, {
      read: t.read,
      deliver: async (_w, runId) => {
        seen.push(runId);
        if (runId === 'run_2') throw new Error('subscriber table away');
      },
    });
    expect(await tail.pass()).toBe(2);
    expect(seen).toEqual(['run_2', 'run_3']);
    expect(tail.cursor().id).toBe(uuid(3));
    errors.mockRestore();
  });
});

describe('deliverCompletionOnce', () => {
  it('fans a run out once, whether the bus or the tail says it first', async () => {
    const calls: string[] = [];
    const deliver = async (w: string, r: string) => { calls.push(`${w}:${r}`); return 1; };
    // The in-process listener and the tail hear the same run at the same moment.
    const [bus, tail] = await Promise.all([deliverCompletionOnce('wf_1', 'run_1', deliver), deliverCompletionOnce('wf_1', 'run_1', deliver)]);
    expect([bus, tail]).toEqual([true, false]);
    expect(await deliverCompletionOnce('wf_1', 'run_2', deliver)).toBe(true);
    expect(calls).toEqual(['wf_1:run_1', 'wf_1:run_2']);
  });

  it('does not throw when the fan-out fails, and forgets the run so it is tried again', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const deliver = vi.fn(async () => { if (fail) throw new Error('away'); return 1; });
    expect(await deliverCompletionOnce('wf_9', 'run_9', deliver)).toBe(false);
    fail = false;
    expect(await deliverCompletionOnce('wf_9', 'run_9', deliver)).toBe(true);
    // Delivered now: a third hearing is not a third fan-out.
    expect(await deliverCompletionOnce('wf_9', 'run_9', deliver)).toBe(false);
    expect(deliver).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });

  it('holds the run while a fan-out is in flight, so the other road cannot double it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const deliver = vi.fn(async () => { await gate; return 1; });
    const first = deliverCompletionOnce('wf_8', 'run_8', deliver);
    expect(await deliverCompletionOnce('wf_8', 'run_8', deliver)).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
