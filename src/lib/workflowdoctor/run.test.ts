import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable "recent user messages" for the idle gate, the advisory-lock verdict,
// and a counter for the two db.execute round-trips the lock costs.
const h = vi.hoisted(() => ({
  userRows: [] as Array<{ id: string }>,
  locked: true,
  execCalls: 0,
}));

vi.mock('$lib/db', () => {
  const builder: Record<string, unknown> = {};
  builder.from = () => builder;
  builder.where = () => builder;
  builder.orderBy = () => builder;
  builder.limit = () => Promise.resolve(h.userRows);
  return {
    db: {
      select: () => builder,
      // leader-lock runs for real against this — pg_try_advisory_lock returns
      // one row with a `locked` boolean, and the unlock ignores its result.
      execute: () => {
        h.execCalls++;
        return Promise.resolve({ rows: [{ locked: h.locked }] });
      },
    },
  };
});

vi.mock('$lib/datastore', () => ({
  upsertRecord: vi.fn().mockResolvedValue({ id: 'run1' }),
}));

// The idle gate is selfimprove's, reused rather than duplicated — mocked here so
// the doctor's unit tests do not import that pipeline's module graph.
vi.mock('$lib/selfimprove/run', () => ({
  isUserActive: vi.fn(async () => h.userRows.length > 0),
}));

vi.mock('$lib/server/models/settings', () => ({ getSetting: vi.fn().mockResolvedValue(null) }));

// Phase modules are mocked — run.ts orchestration is what's under test.
vi.mock('./triage', () => ({
  triageNow: vi.fn(),
  signatureOf: (s: unknown) => String(s ?? '').slice(0, 80),
}));
vi.mock('./lint', () => ({ lintWorkflows: vi.fn() }));
vi.mock('./classify', () => ({ classifySignature: vi.fn(), diagnoseWithLlm: vi.fn() }));
vi.mock('./fix', () => ({ applyFixes: vi.fn(), quarantineRunaways: vi.fn() }));
vi.mock('./report', () => ({ finalizeAndNotify: vi.fn() }));
vi.mock('./findings', () => ({
  ensureDoctorCollections: vi.fn(),
  getFinding: vi.fn(),
  resolveStaleFindings: vi.fn(),
  upsertFinding: vi.fn(),
}));

import { upsertRecord } from '$lib/datastore';
import { getSetting } from '$lib/server/models/settings';
import { triageNow } from './triage';
import { lintWorkflows } from './lint';
import { classifySignature, diagnoseWithLlm } from './classify';
import { applyFixes, quarantineRunaways } from './fix';
import { finalizeAndNotify } from './report';
import { ensureDoctorCollections, getFinding, resolveStaleFindings, upsertFinding } from './findings';
import { SETTINGS_AUTOAPPLY_KEY, SETTINGS_BREAKER_KEY, findingKey } from './types';
import type { DoctorRunData } from './types';
import {
  runDoctorNow,
  createBudget,
  buildCandidates,
  BudgetExceededError,
  acquireRunLock,
  releaseRunLock,
  getDoctorStatus,
} from './run';

// ---------------------------------------------------------------------------
// Fixtures — the real production shape: one enum defect and one orphaned node
// type whose canvas has already had its schedule disabled by hand.
// ---------------------------------------------------------------------------

const ENUM_SIG = 'interactive-step mode must be one of "vnc", "confirm", "both" (got "browse")';
const DEAD_SIG = 'No executor found for node type: icloud-cal';

const ENUM_KEY = findingKey('w1', 'n1', ENUM_SIG);
const DEAD_KEY = findingKey('w2', 'n2', DEAD_SIG);
// The breaker keys on the schedule, not on any node — fix.ts's own handle.
const QUAR_KEY = findingKey('w2', 'schedule:s1', DEAD_SIG);

function triageFixture() {
  return {
    signatures: [
      {
        workflowId: 'w1',
        workflowName: 'canvas:demo',
        canvasSlug: 'demo',
        level: 'node',
        nodeId: 'n1',
        nodeType: 'interactive-step',
        nodeLabel: 'Open page',
        signature: ENUM_SIG,
        count: 5,
        firstSeen: '2026-07-27T00:00:00.000Z',
        lastSeen: '2026-08-01T00:00:00.000Z',
        lastRunId: 'r1',
        actionable: true,
        examples: [],
      },
      {
        workflowId: 'w2',
        workflowName: 'canvas:icloud-new-event',
        canvasSlug: 'icloud-new-event',
        level: 'run',
        nodeId: null,
        nodeType: null,
        nodeLabel: null,
        signature: DEAD_SIG,
        count: 3789,
        firstSeen: '2026-07-27T00:00:00.000Z',
        lastSeen: '2026-08-01T00:00:00.000Z',
        lastRunId: 'r2',
        actionable: true,
        examples: [],
      },
    ],
    deadNodeTypes: [
      {
        workflowId: 'w2',
        workflowName: 'canvas:icloud-new-event',
        canvasSlug: 'icloud-new-event',
        nodeId: 'n2',
        nodeLabel: 'iCloud calendar',
        deadType: 'icloud-cal',
        candidate: 'apple-calendar',
        candidateConfidence: 0.5,
      },
    ],
    runaways: [
      {
        scheduleId: 's1',
        workflowId: 'w2',
        workflowName: 'canvas:icloud-new-event',
        canvasSlug: 'icloud-new-event',
        cronExpr: '*/5 * * * *',
        consecutiveFailures: 10,
        signature: DEAD_SIG,
        wastedRuns: 3789,
      },
    ],
    workflowsFailing: 2,
    silentFailures: [],
  };
}

function lintFixture(errorCount = 2) {
  return new Map([
    ['w1', { issues: [], errorCount, warningCount: 1, byNodeId: {} }],
    ['w2', { issues: [], errorCount: 1, warningCount: 0, byNodeId: {} }],
  ]);
}

/** Read back the persisted run record. `asData` is a cast, so this is live. */
function lastPersisted(): DoctorRunData {
  const calls = vi.mocked(upsertRecord).mock.calls;
  return (calls[calls.length - 1]?.[1] as unknown as { data: DoctorRunData }).data;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.userRows = [];
  h.locked = true;
  h.execCalls = 0;
  releaseRunLock();

  vi.mocked(upsertRecord).mockResolvedValue({ id: 'run1' } as never);
  vi.mocked(getSetting).mockResolvedValue(null as never);
  vi.mocked(ensureDoctorCollections).mockResolvedValue(undefined as never);
  vi.mocked(finalizeAndNotify).mockResolvedValue(undefined as never);
  vi.mocked(triageNow).mockResolvedValue(triageFixture() as never);
  vi.mocked(lintWorkflows).mockResolvedValue(lintFixture() as never);
  vi.mocked(getFinding).mockResolvedValue(null as never);
  vi.mocked(upsertFinding).mockResolvedValue({} as never);
  vi.mocked(resolveStaleFindings).mockResolvedValue(0 as never);
  vi.mocked(diagnoseWithLlm).mockResolvedValue(null as never);

  // enum-violation is on the auto-apply whitelist; dead-node-type is not.
  vi.mocked(classifySignature).mockImplementation((input) =>
    input.signature.startsWith('No executor')
      ? {
          fixKind: 'dead-node-type',
          symptom: 'Every run fails immediately.',
          cause: "This canvas uses a node type ('icloud-cal') that no longer exists.",
          fix: "Replace it with 'apple-calendar'.",
          causeSource: 'signature',
          confident: true,
        }
      : {
          fixKind: 'enum-violation',
          symptom: 'This node fails every run.',
          cause: 'The stored mode is not one of the legal values.',
          fix: 'Snap the value to the legal option.',
          causeSource: 'linter',
          confident: true,
        },
  );

  vi.mocked(quarantineRunaways).mockResolvedValue({
    outcomes: [
      {
        scheduleId: 's1',
        workflowId: 'w2',
        canvasSlug: 'icloud-new-event',
        status: 'quarantined',
        reason: 'breaker tripped',
        findingKey: QUAR_KEY,
      },
    ],
    quarantined: 1,
    actions: [
      {
        kind: 'schedule_quarantined',
        detail: 'icloud-new-event: paused */5 * * * * after 10 consecutive failures',
      },
    ],
    enabled: true,
  } as never);
  vi.mocked(applyFixes).mockResolvedValue({
    outcomes: [
      {
        workflowId: 'w1',
        nodeId: 'n1',
        fixKind: 'enum-violation',
        status: 'applied',
        reason: 'lint errors 2 → 1',
        findingKey: ENUM_KEY,
        verifyBefore: 2,
        verifyAfter: 1,
      },
    ],
    applied: 1,
    reverted: 0,
    refusedSensitive: 0,
    actions: [{ kind: 'fix_applied', detail: 'canvas:demo — enum-violation' }],
    enabled: true,
  } as never);
});

describe('run lock (overlap guard)', () => {
  it('acquires once and refuses a second concurrent acquire', () => {
    expect(acquireRunLock()).toBe(true);
    expect(acquireRunLock()).toBe(false);
    releaseRunLock();
    expect(acquireRunLock()).toBe(true);
    releaseRunLock();
  });

  it('runDoctorNow rejects when a run is already in progress', async () => {
    expect(acquireRunLock()).toBe(true);
    await expect(runDoctorNow({ trigger: 'manual' })).rejects.toThrow(/already in progress/);
    releaseRunLock();
  });
});

describe('budget caps', () => {
  it('throws BudgetExceededError once the call cap is hit, before any network', async () => {
    const b = createBudget({ maxLlmCalls: 0 });
    await expect(b.call([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(BudgetExceededError);
    expect(b.exceeded).toBe(true);
    expect(b.llmCalls).toBe(0);
  });

  it('throws BudgetExceededError once the cost cap is hit', async () => {
    const b = createBudget({ maxCostUsd: 0 });
    await expect(b.call([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('reports the wall clock left', () => {
    expect(createBudget({ maxWallMs: 5000 }).timeLeftMs()).toBeGreaterThan(0);
    expect(createBudget({ maxWallMs: 0 }).timeLeftMs()).toBe(0);
  });
});

describe('buildCandidates', () => {
  it('folds the run-level dead-type signature into the node-level row', () => {
    const cands = buildCandidates(triageFixture() as never, lintFixture() as never);
    // Two signatures in, two candidates out — but the nodeId-less one is gone.
    expect(cands).toHaveLength(2);
    expect(cands.every((c) => c.nodeId !== null)).toBe(true);
    const dead = cands.find((c) => c.source === 'dead-node-type');
    expect(dead?.nodeId).toBe('n2');
    expect(dead?.occurrences).toBe(3789);
    expect(dead?.successor).toBe('apple-calendar');
  });

  it('keeps a dead node type with zero runtime failures — the disabled-canvas case', () => {
    const t = triageFixture();
    // Both real orphaned canvases had their schedules stopped by hand, so they
    // produce no failures at all in the window.
    t.signatures = [t.signatures[0]];
    t.runaways = [];
    const cands = buildCandidates(t as never, lintFixture() as never);
    const dead = cands.find((c) => c.source === 'dead-node-type');
    expect(dead).toBeTruthy();
    expect(dead?.occurrences).toBe(0);
  });
});

describe('runDoctorNow — gating & status', () => {
  it('aborts a cron run when the user is active at start (no phases run)', async () => {
    h.userRows = [{ id: 'm1' }];
    const { runId } = await runDoctorNow({ trigger: 'cron' });
    expect(runId).toBeTruthy();
    expect(triageNow).not.toHaveBeenCalled();
    expect(lintWorkflows).not.toHaveBeenCalled();
    expect(finalizeAndNotify).not.toHaveBeenCalled();
    expect(lastPersisted().status).toBe('aborted_user_active');
    expect(getDoctorStatus().running).toBe(false);
  });

  it('completes a manual run end-to-end with every phase called', async () => {
    // A manual run deliberately bypasses the idle gate.
    h.userRows = [{ id: 'm1' }];
    const { runId } = await runDoctorNow({ trigger: 'manual' });
    expect(runId).toBeTruthy();
    expect(triageNow).toHaveBeenCalled();
    expect(lintWorkflows).toHaveBeenCalled();
    expect(classifySignature).toHaveBeenCalledTimes(2);
    expect(quarantineRunaways).toHaveBeenCalled();
    expect(applyFixes).toHaveBeenCalled();
    // verify re-lints exactly the workflow the fix phase said it touched.
    expect(vi.mocked(lintWorkflows).mock.calls[1]?.[0]).toEqual(['w1']);
    expect(upsertFinding).toHaveBeenCalled();
    expect(resolveStaleFindings).toHaveBeenCalled();
    expect(finalizeAndNotify).toHaveBeenCalled();

    const data = lastPersisted();
    expect(data.status).toBe('complete');
    expect(Object.values(data.phases).every((p) => p.status === 'ok')).toBe(true);
    expect(getDoctorStatus().running).toBe(false);
  });

  it('records the triage headline and derives every outcome count from the actions', async () => {
    await runDoctorNow({ trigger: 'manual' });
    const data = lastPersisted();
    expect(data.workflowsFailing).toBe(2);
    expect(data.signaturesSeen).toBe(2);
    expect(data.schedulesQuarantined).toBe(1);
    expect(data.fixesApplied).toBe(1);
    // The enum finding belongs to the fix phase; only the orphaned node is proposed.
    expect(data.proposalsOpened).toBe(1);
    expect(data.fixesReverted).toBe(0);
    expect(data.fixesRefusedSensitive).toBe(0);
  });

  it('does not rewrite a finding the fix phase already owns, and sweeps on both keys', async () => {
    await runDoctorNow({ trigger: 'manual' });
    const written = vi.mocked(upsertFinding).mock.calls.map((c) => c[0]);
    expect(written).toHaveLength(1);
    expect(written[0].fixKind).toBe('dead-node-type');
    expect(written[0].status).toBe('proposed');

    const seen = vi.mocked(resolveStaleFindings).mock.calls[0]?.[0] as Set<string>;
    // The quarantine finding fix.ts just wrote is in the set too — leave it out
    // and the sweep resolves it in the same run that raised it.
    expect([...seen].sort()).toEqual([ENUM_KEY, DEAD_KEY, QUAR_KEY].sort());
  });

  it('hands the fix phase a flat, node-bound candidate off the whitelist only', async () => {
    await runDoctorNow({ trigger: 'manual' });
    const sent = vi.mocked(applyFixes).mock.calls[0][0];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      workflowId: 'w1',
      workflowName: 'canvas:demo',
      nodeId: 'n1',
      fixKind: 'enum-violation',
      signature: ENUM_SIG,
      causeSource: 'linter',
    });
  });

  it('stores the INCREASE in occurrences, not the whole 7-day window again', async () => {
    // Last night this finding already carried 3,000 of the same failures.
    vi.mocked(getFinding).mockResolvedValue({ occurrences: 3000 } as never);
    await runDoctorNow({ trigger: 'manual' });
    expect(vi.mocked(upsertFinding).mock.calls[0][0].occurrences).toBe(789);
  });

  it('marks the run partial when a phase throws, and later phases still run', async () => {
    vi.mocked(lintWorkflows).mockRejectedValueOnce(new Error('registry boom'));
    const { runId } = await runDoctorNow({ trigger: 'manual' });
    expect(runId).toBeTruthy();
    // The breaker does not depend on the linter, and must not be lost with it.
    expect(quarantineRunaways).toHaveBeenCalled();
    expect(resolveStaleFindings).toHaveBeenCalled();
    expect(finalizeAndNotify).toHaveBeenCalled();
    const data = lastPersisted();
    expect(data.status).toBe('partial');
    expect(data.phases.lint.status).toBe('failed');
    expect(data.phases.fix.status).toBe('ok');
    expect(data.phases.propose.status).toBe('ok');
  });

  it('marks the run budget_exceeded and skips the rest when diagnose hits the cap', async () => {
    vi.mocked(classifySignature).mockReturnValue(null);
    vi.mocked(diagnoseWithLlm).mockRejectedValueOnce(new BudgetExceededError('budget exceeded') as never);
    await runDoctorNow({ trigger: 'manual' });
    expect(applyFixes).not.toHaveBeenCalled();
    expect(quarantineRunaways).not.toHaveBeenCalled();
    const data = lastPersisted();
    expect(data.status).toBe('budget_exceeded');
    expect(data.phases.fix.status).toBe('skipped');
    // The report still goes out — a night that ran out of budget is still news.
    expect(finalizeAndNotify).toHaveBeenCalled();
  });

  it('never rethrows a top-level surprise into the scheduler', async () => {
    vi.mocked(triageNow).mockImplementation(() => {
      throw new Error('sync boom');
    });
    // A phase throw is caught by the phase loop, so force the failure earlier.
    vi.mocked(getSetting).mockRejectedValueOnce(new Error('settings down') as never);
    const { runId } = await runDoctorNow({ trigger: 'manual' });
    expect(runId).toBeTruthy();
    expect(getDoctorStatus().running).toBe(false);
  });
});

describe('runDoctorNow — write switches', () => {
  it('is propose-only by default: auto-apply off, breaker on', async () => {
    await runDoctorNow({ trigger: 'manual' });
    const data = lastPersisted();
    expect(data.autoApplyEnabled).toBe(false);
    expect(data.breakerEnabled).toBe(true);
    expect(vi.mocked(applyFixes).mock.calls[0][1]?.enabled).toBe(false);
    expect(vi.mocked(quarantineRunaways).mock.calls[0][1]?.enabled).toBe(true);
  });

  it('enables auto-apply only on an explicit true', async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) =>
      key === SETTINGS_AUTOAPPLY_KEY ? (true as never) : (null as never),
    );
    await runDoctorNow({ trigger: 'manual' });
    expect(lastPersisted().autoApplyEnabled).toBe(true);
  });

  it('disables the breaker on an explicit false', async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) =>
      key === SETTINGS_BREAKER_KEY ? (false as never) : (null as never),
    );
    await runDoctorNow({ trigger: 'manual' });
    expect(lastPersisted().breakerEnabled).toBe(false);
  });

  it('falls back to propose-only when the settings read fails', async () => {
    vi.mocked(getSetting).mockRejectedValue(new Error('settings down') as never);
    await runDoctorNow({ trigger: 'manual' });
    const data = lastPersisted();
    expect(data.autoApplyEnabled).toBe(false);
    expect(data.breakerEnabled).toBe(false);
    // Still a full run — losing the switches costs the write path, not the report.
    expect(data.status).toBe('complete');
  });
});

describe('runDoctorNow — advisory lock', () => {
  it('acquires and releases the lane around the run', async () => {
    await runDoctorNow({ trigger: 'manual' });
    expect(h.execCalls).toBe(2);
  });

  it('degrades to propose-only when another instance holds the lane', async () => {
    h.locked = false;
    vi.mocked(getSetting).mockResolvedValue(true as never);
    await runDoctorNow({ trigger: 'manual' });
    const data = lastPersisted();
    // The switches both said yes; the lock is what said no.
    expect(data.autoApplyEnabled).toBe(false);
    expect(data.breakerEnabled).toBe(false);
    expect(data.status).toBe('complete');
    // No unlock attempted on a lane we never held.
    expect(h.execCalls).toBe(1);
  });
});
