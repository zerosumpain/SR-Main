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
vi.mock('./toolsmith', () => ({ buildTool: vi.fn() }));
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
import { buildTool } from './toolsmith';
import { repairTools } from './repair';
import { proposeFeatures } from './propose';
import { optimiseCalls } from './optimise';
import { finalizeAndNotify } from './report';
import { ensureSystemCollections } from './seed-apis';
import {
  runImprovementNow,
  createBudget,
  BudgetExceededError,
  isUserActive,
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
  vi.mocked(buildTool).mockResolvedValue([] as never);
  vi.mocked(repairTools).mockResolvedValue([] as never);
  vi.mocked(proposeFeatures).mockResolvedValue([] as never);
  vi.mocked(optimiseCalls).mockResolvedValue([] as never);
});

describe('isUserActive (idle gate)', () => {
  it('returns true when a recent user message exists', async () => {
    h.userRows = [{ id: 'm1' }];
    expect(await isUserActive()).toBe(true);
  });
  it('returns false when there is no recent user message', async () => {
    h.userRows = [];
    expect(await isUserActive()).toBe(false);
  });
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

describe('budget caps', () => {
  it('throws BudgetExceededError once the call cap is hit', async () => {
    const b = createBudget({ maxLlmCalls: 0 });
    await expect(b.call([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(BudgetExceededError);
    expect(b.exceeded).toBe(true);
  });

  it('throws BudgetExceededError once the cost cap is hit', async () => {
    const b = createBudget({ maxCostUsd: 0 });
    await expect(b.call([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(BudgetExceededError);
  });
});

describe('runImprovementNow — gating & status', () => {
  it('aborts a cron run when the user is active at start (no phases run)', async () => {
    h.userRows = [{ id: 'm1' }];
    const { runId } = await runImprovementNow({ trigger: 'cron' });
    expect(runId).toBeTruthy();
    expect(learnInsights).not.toHaveBeenCalled();
    expect(lastPersisted().data.status).toBe('aborted_user_active');
    expect(getImprovementStatus().running).toBe(false);
  });

  it('completes a manual run end-to-end and reports', async () => {
    const { runId } = await runImprovementNow({ trigger: 'manual' });
    expect(runId).toBeTruthy();
    expect(gatherSignals).toHaveBeenCalled();
    expect(learnInsights).toHaveBeenCalled();
    expect(discoverApis).toHaveBeenCalled();
    expect(buildTool).toHaveBeenCalled();
    // Repair and propose are the phases that make a night productive when there
    // is nothing new worth building — they must run, not just exist.
    expect(repairTools).toHaveBeenCalled();
    expect(proposeFeatures).toHaveBeenCalled();
    expect(finalizeAndNotify).toHaveBeenCalled();
    expect(lastPersisted().data.status).toBe('complete');
    expect(getImprovementStatus().running).toBe(false);
  });

  it('still runs repair when build fails — a bad build must not sink the night', async () => {
    vi.mocked(buildTool).mockRejectedValueOnce(new Error('author failed'));
    await runImprovementNow({ trigger: 'manual' });
    expect(repairTools).toHaveBeenCalled();
    const data = lastPersisted().data;
    expect(data.phases.build.status).toBe('failed');
    expect(data.phases.repair.status).toBe('ok');
    expect(data.status).toBe('partial');
  });

  it('marks the run partial when a phase throws (never rethrows)', async () => {
    vi.mocked(discoverApis).mockRejectedValueOnce(new Error('boom'));
    const { runId } = await runImprovementNow({ trigger: 'manual' });
    expect(runId).toBeTruthy();
    // build still ran after discover failed
    expect(buildTool).toHaveBeenCalled();
    expect(finalizeAndNotify).toHaveBeenCalled();
    const data = lastPersisted().data;
    expect(data.status).toBe('partial');
    expect(data.phases.discover.status).toBe('failed');
  });

  it('marks the run budget_exceeded when a phase hits the LLM budget', async () => {
    vi.mocked(learnInsights).mockRejectedValueOnce(new BudgetExceededError('budget exceeded'));
    const { runId } = await runImprovementNow({ trigger: 'manual' });
    expect(runId).toBeTruthy();
    // discover/build are skipped after a budget stop
    expect(discoverApis).not.toHaveBeenCalled();
    expect(buildTool).not.toHaveBeenCalled();
    expect(lastPersisted().data.status).toBe('budget_exceeded');
  });
});
