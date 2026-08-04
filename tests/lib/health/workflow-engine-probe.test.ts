import { describe, it, expect, vi, beforeEach } from 'vitest';

// The probe is what systemd's watchdog acts on: a 503 restarts production.
// These cases pin the exact boundary between "busy" and "broken".
vi.mock('$lib/workflows/engine-runtime', () => ({
  readEventLoopMaxMs: vi.fn(),
  getRuntimeStats: vi.fn(() => ({ activeRuns: 0, queued: 0, cap: 5 })),
  activeBatches: vi.fn(() => []),
}));

import { readEventLoopMaxMs, activeBatches } from '$lib/workflows/engine-runtime';
import { GET } from '../../../src/routes/api/health/workflow-engine/+server';

const call = async () => {
  const res = await (GET as unknown as (e: unknown) => Promise<Response>)({});
  return { status: res.status, body: await res.json() };
};

const batch = (over: Record<string, unknown> = {}) => ({
  name: 'intel:sweep',
  phase: 'working',
  runningMs: 60_000,
  sinceBeatMs: 1_000,
  stale: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(activeBatches).mockReturnValue([]);
});

describe('workflow-engine health probe', () => {
  it('is healthy when the loop is responsive', async () => {
    vi.mocked(readEventLoopMaxMs).mockReturnValue(40);
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.busyWithBatch).toBe(false);
  });

  it('503s on a stall with nothing to explain it — the wedged case', async () => {
    vi.mocked(readEventLoopMaxMs).mockReturnValue(7_400);
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
  });

  // The regression this exists for: the nightly sweep was restarted mid-run.
  it('stays healthy on a stall while a live batch is beating', async () => {
    vi.mocked(readEventLoopMaxMs).mockReturnValue(7_400);
    vi.mocked(activeBatches).mockReturnValue([batch()] as never);
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.busyWithBatch).toBe(true);
    expect(body.batches[0].phase).toBe('working');
  });

  // The safety property: a batch that stopped reporting must NOT hold the
  // watchdog off, or a genuinely hung sweep becomes an outage nothing recovers.
  it('503s on a stall when the only batch has gone stale', async () => {
    vi.mocked(readEventLoopMaxMs).mockReturnValue(7_400);
    vi.mocked(activeBatches).mockReturnValue([batch({ stale: true, sinceBeatMs: 300_000 })] as never);
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body.busyWithBatch).toBe(false);
  });

  it('one live batch is enough even if another has gone stale', async () => {
    vi.mocked(readEventLoopMaxMs).mockReturnValue(9_000);
    vi.mocked(activeBatches).mockReturnValue([
      batch({ name: 'a', stale: true }),
      batch({ name: 'b', stale: false }),
    ] as never);
    expect((await call()).status).toBe(200);
  });

  it('a live batch does not mask an otherwise healthy report', async () => {
    vi.mocked(readEventLoopMaxMs).mockReturnValue(30);
    vi.mocked(activeBatches).mockReturnValue([batch()] as never);
    const { status, body } = await call();
    expect(status).toBe(200);
    // Not "excused" — there was nothing to excuse.
    expect(body.busyWithBatch).toBe(false);
  });

  it('reports the threshold it judged against', async () => {
    vi.mocked(readEventLoopMaxMs).mockReturnValue(10);
    expect((await call()).body.loopThresholdMs).toBe(5000);
  });
});
