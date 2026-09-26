import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable "recent user messages" for the idle-gate query.
const h = vi.hoisted(() => ({ userRows: [] as Array<{ id: string }> }));

vi.mock('$lib/db', () => {
  const builder: Record<string, unknown> = {};
  builder.from = () => builder;
  builder.where = () => builder;
  builder.orderBy = () => builder;
  builder.limit = () => Promise.resolve(h.userRows);
  return { db: { select: () => builder } };
});

vi.mock('$lib/datastore', () => ({
  upsertRecord: vi.fn().mockResolvedValue({ id: 'run1' }),
}));

// Phase modules + seeds are mocked — run.ts orchestration is what's under test.
vi.mock('./analyze', () => ({ gatherSignals: vi.fn(), learnInsights: vi.fn() }));
vi.mock('./discover', () => ({ discoverApis: vi.fn() }));
vi.mock('./repair', () => ({ repairTools: vi.fn() }));
vi.mock('./propose', () => ({ proposeFeatures: vi.fn() }));
vi.mock('./optimise', () => ({ optimiseCalls: vi.fn() }));
vi.mock('./report', () => ({ finalizeAndNotify: vi.fn() }));
vi.mock('./seed-apis', () => ({
  ensureSystemCollections: vi.fn(),
  runSeeds: vi.fn(),
  seedApiCatalog: vi.fn(),
  SEEDED_APIS: [],
}));

import { upsertRecord } from '$lib/datastore';
import { gatherSignals, learnInsights } from './analyze';
import { discoverApis } from './discover';
import { repairTools } from './repair';
import { proposeFeatures } from './propose';
import { optimiseCalls } from './optimise';
import { finalizeAndNotify } from './report';
import { ensureSystemCollections } from './seed-apis';
import {
  runImprovementNow,
  BudgetExceededError,
  acquireRunLock,
  releaseRunLock,
  getImprovementStatus,
} from './run';

/** Read back the last persisted run record's data. */
function lastPersisted() {
  const calls = vi.mocked(upsertRecord).mock.calls;
  return calls[calls.length - 1]?.[1] as unknown as {
    data: { status: string; llmCalls: number; phases: Record<string, { status: string }> };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.userRows = [];
  releaseRunLock();
  vi.mocked(ensureSystemCollections).mockResolvedValue(undefined as never);
  vi.mocked(upsertRecord).mockResolvedValue({ id: 'run1' } as never);
  vi.mocked(finalizeAndNotify).mockResolvedValue(undefined as never);
  vi.mocked(gatherSignals).mockResolvedValue({
    messages: [],
    toolAudit: null,
    customTools: [],
    currentInsights: null,
  } as never);
  vi.mocked(learnInsights).mockResolvedValue({
    insights: { period: '2026-29', generatedAt: 'now', intents: [], topUnmet: [] },
    actions: [{ kind: 'insight', detail: 'ok' }],
  } as never);
  vi.mocked(discoverApis).mockResolvedValue([] as never);
  vi.mocked(repairTools).mockResolvedValue([] as never);
  vi.mocked(proposeFeatures).mockResolvedValue([] as never);
  vi.mocked(optimiseCalls).mockResolvedValue([] as never);
});

describe('run lock (overlap guard)', () => {
  it('acquires once and refuses a second concurrent acquire', () => {
    expect(acquireRunLock()).toBe(true);
    expect(acquireRunLock()).toBe(false);
    releaseRunLock();
    expect(acquireRunLock()).toBe(true);
    releaseRunLock();
  });

  it('runImprovementNow rejects when a run is already in progress', async () => {
    expect(acquireRunLock()).toBe(true);
    await expect(runImprovementNow({ trigger: 'manual' })).rejects.toThrow(/already in progress/);
    releaseRunLock();
  });
});

describe('runImprovementNow — gating & status', () => {
  it('aborts a cron run when the user is active at start (no phases run)', async () => {
    const { runId } = await runImprovementNow({ trigger: 'cron', isUserActive: async () => true });
    expect(runId).toBeTruthy();
    expect(learnInsights).not.toHaveBeenCalled();
    expect(lastPersisted().data.status).toBe('aborted_user_active');
    expect(getImprovementStatus().running).toBe(false);
  });

  it('fails CLOSED when a cron run is given no idle gate', async () => {
    await runImprovementNow({ trigger: 'cron' });
    expect(learnInsights).not.toHaveBeenCalled();
    expect(lastPersisted().data.status).toBe('aborted_user_active');
  });

  it('completes a manual run end-to-end and reports', async () => {
    const { runId } = await runImprovementNow({ trigger: 'manual' });
    expect(runId).toBeTruthy();
    expect(gatherSignals).toHaveBeenCalled();
    expect(learnInsights).toHaveBeenCalled();
    expect(discoverApis).toHaveBeenCalled();
    // The toolsmith was retired (D3): its phase stays in the record, skipped,
    // so every run keeps the same shape.
    expect(lastPersisted().data.phases.build.status).toBe('skipped');
    // Repair and propose are the phases that make a night productive when there
    // is nothing new worth building — they must run, not just exist.
    expect(repairTools).toHaveBeenCalled();
    expect(proposeFeatures).toHaveBeenCalled();
    expect(finalizeAndNotify).toHaveBeenCalled();
    expect(lastPersisted().data.status).toBe('complete');
    expect(getImprovementStatus().running).toBe(false);
  });

  it('still runs propose when repair fails — a bad phase must not sink the night', async () => {
    vi.mocked(repairTools).mockRejectedValueOnce(new Error('author failed'));
    await runImprovementNow({ trigger: 'manual' });
    expect(proposeFeatures).toHaveBeenCalled();
    const data = lastPersisted().data;
    expect(data.phases.repair.status).toBe('failed');
    expect(data.phases.propose.status).toBe('ok');
    expect(data.status).toBe('partial');
  });

  it('marks the run partial when a phase throws (never rethrows)', async () => {
    vi.mocked(discoverApis).mockRejectedValueOnce(new Error('boom'));
    const { runId } = await runImprovementNow({ trigger: 'manual' });
    expect(runId).toBeTruthy();
    // repair still ran after discover failed
    expect(repairTools).toHaveBeenCalled();
    expect(finalizeAndNotify).toHaveBeenCalled();
    const data = lastPersisted().data;
    expect(data.status).toBe('partial');
    expect(data.phases.discover.status).toBe('failed');
  });

  it('marks the run budget_exceeded when a phase hits the LLM budget', async () => {
    vi.mocked(learnInsights).mockRejectedValueOnce(new BudgetExceededError('budget exceeded'));
    const { runId } = await runImprovementNow({ trigger: 'manual' });
    expect(runId).toBeTruthy();
    // discover/repair are skipped after a budget stop
    expect(discoverApis).not.toHaveBeenCalled();
    expect(repairTools).not.toHaveBeenCalled();
    expect(lastPersisted().data.status).toBe('budget_exceeded');
  });
});
