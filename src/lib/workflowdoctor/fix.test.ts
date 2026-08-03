import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  /** Rows the schedule UPDATE ... WHERE enabled=true returns. */
  scheduleFlipped: [{ id: 's1' }] as Array<{ id: string }>,
  /** Rows the audit-log quiet-window SELECT returns. */
  auditRows: [] as Array<{ id: string }>,
  /** Bound parameters of the audit-log quiet-window WHERE clause. */
  auditWhereParams: [] as string[],
  /** Stored config per nodeId, as the node SELECT sees it. */
  nodeConfigs: {} as Record<string, Record<string, unknown> | undefined>,
  /** errorCount returned by each successive lintWorkflow() call. */
  lintCounts: [] as number[],
  /** Every workflow_schedules.set() payload, in order. */
  scheduleWrites: [] as Array<Record<string, unknown>>,
}));

vi.mock('$lib/db', () => {
  /** Bound parameter values out of a drizzle clause. It is a cyclic graph, so
   *  descend only through queryChunks rather than stringifying it. */
  const paramValues = (node: unknown, out: string[] = []): string[] => {
    // A value interpolated into a sql`` fragment stays a bare string in
    // queryChunks; only eq()/gte() wrap theirs in a Param object.
    if (typeof node === 'string') {
      out.push(node);
      return out;
    }
    if (!node || typeof node !== 'object') return out;
    const o = node as { value?: unknown; queryChunks?: unknown[] };
    if (typeof o.value === 'string') out.push(o.value);
    if (Array.isArray(o.queryChunks)) for (const c of o.queryChunks) paramValues(c, out);
    return out;
  };

  // The two SELECTs are told apart by which column set they ask for; that is
  // the only distinguishing signal a chainable fake gets.
  const select = (cols?: Record<string, unknown>) => {
    const b: Record<string, unknown> = {};
    const rows = () => {
      if (cols && 'config' in cols) {
        const cfg = h.nodeConfigs[b.__nodeId as string];
        return cfg === undefined ? [] : [{ config: cfg }];
      }
      return h.auditRows;
    };
    b.from = () => b;
    b.where = (clause: unknown) => {
      const params = paramValues(clause);
      // Pull the node id out of the clause so one fake can serve several nodes.
      const id = params.find((v) => /^n\d+$/.test(v));
      if (id) b.__nodeId = id;
      if (!(cols && 'config' in cols)) h.auditWhereParams = params;
      return b;
    };
    b.limit = () => Promise.resolve(rows());
    return b;
  };
  const update = () => ({
    set: (values: Record<string, unknown>) => ({
      where: () => ({
        returning: async () => {
          h.scheduleWrites.push(values);
          return h.scheduleFlipped;
        },
      }),
    }),
  });
  return { db: { select, update } };
});

vi.mock('$lib/server/models/settings', () => ({ getSetting: vi.fn().mockResolvedValue(null) }));
vi.mock('./findings', () => ({ upsertFinding: vi.fn(async (i: unknown) => i) }));
vi.mock('./lint', () => ({ lintWorkflow: vi.fn() }));
vi.mock('$lib/canvas/mutate.server', async () => {
  const actual = await vi.importActual<typeof import('$lib/canvas/mutate.server')>(
    '$lib/canvas/mutate.server',
  );
  return {
    ...actual,
    mutateNodeConfig: vi.fn(),
    revertNodeConfig: vi.fn(async () => ({})),
  };
});
// scheduler.ts drags the whole node registry in; the breaker only needs the
// one function, and the stub proves we called it.
vi.mock('$lib/workflows/scheduler', () => ({
  unregisterCronJob: vi.fn(),
  reloadSchedule: vi.fn(async () => {}),
}));

import { getSetting } from '$lib/server/models/settings';
import { unregisterCronJob } from '$lib/workflows/scheduler';
import {
  mutateNodeConfig,
  revertNodeConfig,
  SensitiveRefusalError,
  VersionConflictError,
} from '$lib/canvas/mutate.server';
import { upsertFinding } from './findings';
import { lintWorkflow } from './lint';
import {
  applyFixes,
  planFix,
  quarantineRunaways,
  isAutoApplyEnabled,
  isBreakerEnabled,
  type FixCandidate,
} from './fix';
import type { RunawaySchedule } from './triage';
import { findingKey } from './types';

/** A syntactically real OpenRouter key. Never a live one. */
const SECRET = `sk-or-v1-${'a'.repeat(40)}`;

function runaway(over: Partial<RunawaySchedule> = {}): RunawaySchedule {
  return {
    scheduleId: 's1',
    workflowId: 'w1',
    workflowName: 'canvas:icloud-new-event',
    canvasSlug: 'icloud-new-event',
    cronExpr: '*/5 * * * *',
    consecutiveFailures: 10,
    signature: 'No executor found for node type: icloud-cal',
    wastedRuns: 3789,
    ...over,
  };
}

function candidate(over: Partial<FixCandidate> = {}): FixCandidate {
  return {
    workflowId: 'w1',
    workflowName: 'canvas:morning-briefing',
    canvasSlug: 'morning-briefing',
    nodeId: 'n1',
    nodeType: 'interactive-step',
    nodeLabel: 'Open the page',
    fixKind: 'unknown-config-key',
    signature: 'Unknown config key',
    occurrences: 4,
    symptom: 'This node carries a setting the app does not read.',
    cause: "'bogusKey' is not a setting on an interactive-step node.",
    causeSource: 'linter',
    fix: "Delete 'bogusKey' from the node config.",
    lintIssues: [
      {
        nodeId: 'n1',
        nodeLabel: 'Open the page',
        field: 'bogusKey',
        issue: 'Unknown config key "bogusKey". This node type does not read it.',
        severity: 'error',
      },
    ],
    ...over,
  };
}

/** Queue the before/after error counts lintWorkflow() should report, in order. */
function lintReturns(...counts: number[]): void {
  h.lintCounts = counts;
  vi.mocked(lintWorkflow).mockImplementation(async () => {
    const errorCount = h.lintCounts.shift() ?? 0;
    return { issues: [], errorCount, warningCount: 0, byNodeId: {} };
  });
}

/** mutateNodeConfig's happy path — the before-image the revert would replay. */
function mutationSucceeds(changedFields: Record<string, unknown> = { bogusKey: 'orphan' }): void {
  vi.mocked(mutateNodeConfig).mockResolvedValue({
    before: { nodeId: 'n1', version: 3, changedFields },
    after: { version: 4 },
    node: {} as never,
  } as never);
}

function findingCalls() {
  return vi.mocked(upsertFinding).mock.calls.map((c) => c[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.scheduleFlipped = [{ id: 's1' }];
  h.auditRows = [];
  h.auditWhereParams = [];
  h.nodeConfigs = { n1: { model: 'a', bogusKey: 'orphan' } };
  h.lintCounts = [];
  h.scheduleWrites = [];
  vi.mocked(getSetting).mockResolvedValue(null as never);
  lintReturns(2, 1);
  mutationSucceeds();
});

// ---------------------------------------------------------------------------

describe('the switches', () => {
  it('the breaker is on when unset and off only when explicitly false', async () => {
    vi.mocked(getSetting).mockResolvedValue(null as never);
    expect(await isBreakerEnabled()).toBe(true);
    vi.mocked(getSetting).mockResolvedValue(false as never);
    expect(await isBreakerEnabled()).toBe(false);
  });

  it('auto-apply is off when unset and on only when explicitly true', async () => {
    vi.mocked(getSetting).mockResolvedValue(null as never);
    expect(await isAutoApplyEnabled()).toBe(false);
    vi.mocked(getSetting).mockResolvedValue(true as never);
    expect(await isAutoApplyEnabled()).toBe(true);
  });

  it('both fail closed when the settings read throws', async () => {
    vi.mocked(getSetting).mockRejectedValue(new Error('db down') as never);
    expect(await isBreakerEnabled()).toBe(false);
    expect(await isAutoApplyEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('quarantineRunaways (the circuit breaker)', () => {
  it('flips enabled to false and records a revertible before-image', async () => {
    const res = await quarantineRunaways([runaway()], { enabled: true, runId: 'r1' });

    expect(h.scheduleWrites).toEqual([{ enabled: false }]);
    expect(res.quarantined).toBe(1);
    expect(res.outcomes[0].status).toBe('quarantined');

    const finding = findingCalls()[0];
    expect(finding.fixKind).toBe('runaway-schedule');
    expect(finding.status).toBe('auto_fixed');
    // One click back: the schedule id is the handle, and enabled:true is what
    // the revert replays. workflow_schedules has no version counter.
    expect(finding.beforeImage).toEqual({
      nodeId: 'schedule:s1',
      version: 0,
      changedFields: { enabled: true },
      scheduleId: 's1',
    });
  });

  it('stops the in-memory cron as well as the row', async () => {
    await quarantineRunaways([runaway()], { enabled: true });
    expect(unregisterCronJob).toHaveBeenCalledWith('s1');
  });

  it('still quarantines when unregistering the cron throws', async () => {
    vi.mocked(unregisterCronJob).mockImplementationOnce(() => {
      throw new Error('no such job');
    });
    const res = await quarantineRunaways([runaway()], { enabled: true });
    expect(res.quarantined).toBe(1);
  });

  it('emits a story the report can render without re-parsing prose', async () => {
    const res = await quarantineRunaways([runaway()], { enabled: true });
    const story = res.actions[0].story!;

    expect(res.actions[0].kind).toBe('schedule_quarantined');
    expect(story.subject).toBe('icloud-new-event');
    expect(story.symptom).toBe('10 runs in a row failed, none succeeded');
    expect(story.cause).toBe('No executor found for node type: icloud-cal');
    expect(story.fix).toBe('Paused the schedule so it stops burning runs');
    expect(story.fixMode).toBe('auto-apply');
    expect(story.outcomeKind).toBe('measured');
    expect(story.occurrences).toBe(3789);
  });

  it('honours maxSchedulesQuarantined', async () => {
    const many = [1, 2, 3, 4, 5].map((n) =>
      runaway({ scheduleId: `s${n}`, workflowId: `w${n}`, canvasSlug: `c${n}` }),
    );
    const res = await quarantineRunaways(many, { enabled: true, max: 3 });

    expect(res.quarantined).toBe(3);
    expect(h.scheduleWrites).toHaveLength(3);
    expect(res.outcomes.filter((o) => o.status === 'skipped')).toHaveLength(2);
    expect(res.outcomes[3].reason).toMatch(/cap of 3/);
  });

  it('writes nothing at all when the breaker switch is off', async () => {
    const res = await quarantineRunaways([runaway()], { enabled: false });
    expect(res.quarantined).toBe(0);
    expect(h.scheduleWrites).toHaveLength(0);
    expect(upsertFinding).not.toHaveBeenCalled();
  });

  it('records nothing when a human disabled the schedule first', async () => {
    h.scheduleFlipped = [];
    const res = await quarantineRunaways([runaway()], { enabled: true });

    expect(res.quarantined).toBe(0);
    expect(res.outcomes[0].reason).toMatch(/already disabled/);
    // No before-image, so nothing offers to re-arm a cron the owner stopped.
    expect(upsertFinding).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('planFix', () => {
  it('removes only orphan keys that are actually in the config', () => {
    const plan = planFix(candidate(), { model: 'a', bogusKey: 'orphan' });
    expect(plan?.removeKeys).toEqual(['bogusKey']);
  });

  it('declines when the named orphan key is already gone', () => {
    expect(planFix(candidate(), { model: 'a' })).toBeNull();
  });

  it('snaps an enum value that differs only in case', () => {
    const c = candidate({
      fixKind: 'enum-violation',
      lintIssues: [
        {
          nodeId: 'n1',
          nodeLabel: 'x',
          field: 'mode',
          issue: 'Invalid value for "mode": Confirm. Must be one of: vnc, confirm, both.',
          severity: 'error',
        },
      ],
    });
    expect(planFix(c, { mode: 'Confirm' })?.patch).toEqual({ mode: 'confirm' });
  });

  it('refuses to guess when the stored value resembles no legal member', () => {
    // The real production case: interactive-step mode 'browse' against
    // vnc|confirm|both. Picking one would be a coin flip dressed as a fix.
    const c = candidate({
      fixKind: 'enum-violation',
      lintIssues: [
        {
          nodeId: 'n1',
          nodeLabel: 'x',
          field: 'mode',
          issue: 'interactive-step mode must be one of "vnc", "confirm", "both" (got "browse")',
          severity: 'error',
        },
      ],
    });
    expect(planFix(c, { mode: 'browse' })).toBeNull();
  });

  it('tidies placeholder padding but never a Jinja block', () => {
    const c = candidate({
      fixKind: 'unsupported-template-syntax',
      lintIssues: [
        {
          nodeId: 'n1',
          nodeLabel: 'x',
          field: 'message',
          issue: 'Contains Jinja-style blocks. Supported template syntax is {{input.x}}.',
          severity: 'error',
        },
      ],
    });
    expect(planFix(c, { message: 'Hi {{ input.name }}' })?.patch).toEqual({
      message: 'Hi {{input.name}}',
    });
    expect(planFix(c, { message: '{% for x in y %}{{x}}{% endfor %}' })).toBeNull();
  });

  it('leaves the two graph-shaped kinds to an explicit patch', () => {
    expect(planFix(candidate({ fixKind: 'broken-input-ref' }), { a: 1 })).toBeNull();
    expect(planFix(candidate({ fixKind: 'empty-required-field' }), { a: 1 })).toBeNull();
  });

  it('uses an explicit patch verbatim when the caller supplies one', () => {
    const c = candidate({ fixKind: 'broken-input-ref', patch: { source: 'input.rows' } });
    expect(planFix(c, {})?.patch).toEqual({ source: 'input.rows' });
  });
});

// ---------------------------------------------------------------------------

describe('applyFixes — the rails', () => {
  it('writes nothing when auto-apply is off, and does not even read the node', async () => {
    const res = await applyFixes([candidate()], { enabled: false });

    expect(res.applied).toBe(0);
    expect(mutateNodeConfig).not.toHaveBeenCalled();
    expect(lintWorkflow).not.toHaveBeenCalled();
    expect(upsertFinding).not.toHaveBeenCalled();
    expect(res.outcomes[0].status).toBe('skipped');
    expect(res.outcomes[0].reason).toMatch(/switch is off/);
  });

  it('the breaker still runs on a night auto-apply is off', async () => {
    // The owner decision in one assertion: shadow the config edits, quarantine
    // from night one.
    const fixes = await applyFixes([candidate()], { enabled: false });
    const breaker = await quarantineRunaways([runaway()], { enabled: true });

    expect(mutateNodeConfig).not.toHaveBeenCalled();
    expect(fixes.applied).toBe(0);
    expect(breaker.quarantined).toBe(1);
    expect(h.scheduleWrites).toEqual([{ enabled: false }]);
  });

  it('skips a fix kind that is not on the whitelist', async () => {
    const res = await applyFixes([candidate({ fixKind: 'missing-credential' })], { enabled: true });
    expect(mutateNodeConfig).not.toHaveBeenCalled();
    expect(res.outcomes[0].reason).toMatch(/propose-only/);
  });

  it('skips a workflow that is not a canvas', async () => {
    const res = await applyFixes([candidate({ workflowName: 'internal-cleanup' })], {
      enabled: true,
    });
    expect(mutateNodeConfig).not.toHaveBeenCalled();
    expect(res.outcomes[0].reason).toMatch(/outside v1 auto-apply scope/);
  });

  it('skips a workflow a human edited inside the quiet window', async () => {
    h.auditRows = [{ id: 'a1' }];
    const res = await applyFixes([candidate()], { enabled: true });
    expect(mutateNodeConfig).not.toHaveBeenCalled();
    expect(res.outcomes[0].reason).toMatch(/edited by hand in the last 24h/);
  });

  it('excludes its own writes and memory clears from the quiet-window check', async () => {
    await applyFixes([candidate()], { enabled: true });
    // Clearing a node's remembered state writes an audit row too. It edits no
    // config, and it is exactly what someone debugging a canvas does, so it must
    // not read as "a human touched this" and stall the auto-fix for 24h.
    expect(h.auditWhereParams).toContain('system');
    expect(h.auditWhereParams).toContain('memory-clear');
  });

  it('applies a fix that strictly reduces the error count', async () => {
    lintReturns(2, 1);
    const res = await applyFixes([candidate()], { enabled: true, runId: 'r1' });

    expect(res.applied).toBe(1);
    expect(res.reverted).toBe(0);
    expect(revertNodeConfig).not.toHaveBeenCalled();
    expect(vi.mocked(mutateNodeConfig).mock.calls[0][0].removeKeys).toEqual(['bogusKey']);

    const finding = findingCalls()[0];
    expect(finding.status).toBe('auto_fixed');
    expect(finding.verifyBefore).toBe(2);
    expect(finding.verifyAfter).toBe(1);
    expect(finding.beforeImage?.changedFields).toEqual({ bogusKey: 'orphan' });
    expect(res.actions[0].story?.outcomeKind).toBe('measured');
  });

  it('reverts when the error count does not STRICTLY decrease', async () => {
    lintReturns(2, 2);
    const res = await applyFixes([candidate()], { enabled: true });

    expect(res.applied).toBe(0);
    expect(res.reverted).toBe(1);
    expect(revertNodeConfig).toHaveBeenCalledWith(
      { nodeId: 'n1', version: 3, changedFields: { bogusKey: 'orphan' } },
      'system',
    );
    expect(res.outcomes[0].status).toBe('reverted');
    expect(findingCalls()[0].status).toBe('reverted');
    expect(res.actions[0].story?.outcomeKind).toBe('unproven');
  });

  it('reverts when the fix made the graph worse', async () => {
    lintReturns(1, 4);
    const res = await applyFixes([candidate()], { enabled: true });
    expect(res.reverted).toBe(1);
    expect(res.outcomes[0].reason).toMatch(/1 → 4/);
  });

  it('says so loudly when the revert itself fails', async () => {
    lintReturns(2, 2);
    vi.mocked(revertNodeConfig).mockRejectedValueOnce(new Error('conflict') as never);
    const res = await applyFixes([candidate()], { enabled: true });

    expect(res.outcomes[0].status).toBe('failed');
    expect(res.outcomes[0].reason).toMatch(/still in place/);
    // The finding keeps the before-image so the owner can undo it by hand.
    expect(findingCalls()[0].status).toBe('auto_fixed');
    expect(findingCalls()[0].beforeImage).toBeTruthy();
  });

  it('treats a post-write lint failure as an unproven fix and reverts', async () => {
    vi.mocked(lintWorkflow)
      .mockResolvedValueOnce({ issues: [], errorCount: 3, warningCount: 0, byNodeId: {} })
      .mockRejectedValueOnce(new Error('registry blew up') as never);

    const res = await applyFixes([candidate()], { enabled: true });
    expect(res.reverted).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('applyFixes — the sensitive gate', () => {
  it('refuses a node holding a credential, writes nothing, and names only the field', async () => {
    h.nodeConfigs = { n1: { apiKey: SECRET, bogusKey: 'orphan' } };
    const res = await applyFixes([candidate()], { enabled: true });

    expect(mutateNodeConfig).not.toHaveBeenCalled();
    expect(res.refusedSensitive).toBe(1);
    expect(res.outcomes[0].status).toBe('refused_sensitive');

    const finding = findingCalls()[0];
    expect(finding.fixKind).toBe('secret-in-node-config');
    expect(finding.status).toBe('refused_sensitive');
    expect(finding.sensitiveFields).toEqual(['apiKey']);
    expect(finding.beforeImage).toBeUndefined();
    // Not one byte of the value reaches the run record or the finding.
    const everything = JSON.stringify([res, finding]);
    expect(everything).toContain('apiKey');
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain('sk-or-v1');
  });

  it('honours the write adapter s refusal too, not just its own scan', async () => {
    // Defence in depth: mutate.server is the authority on what may be written.
    vi.mocked(mutateNodeConfig).mockRejectedValueOnce(
      new SensitiveRefusalError(['headers.Authorization']) as never,
    );
    const res = await applyFixes([candidate()], { enabled: true });

    expect(res.refusedSensitive).toBe(1);
    expect(findingCalls()[0].sensitiveFields).toEqual(['headers.Authorization']);
    expect(res.actions[0].kind).toBe('fix_refused_sensitive');
  });

  it('skips personal data quietly instead of crying secret', async () => {
    // Nine live whatsapp nodes carry a recipient. Refusing to patch them is
    // right; putting them on the "needs you" line of the report is not.
    h.nodeConfigs = { n1: { to: 'someone@example.com', bogusKey: 'orphan' } };
    const res = await applyFixes([candidate()], { enabled: true });

    expect(mutateNodeConfig).not.toHaveBeenCalled();
    expect(res.refusedSensitive).toBe(0);
    expect(res.outcomes[0].status).toBe('skipped');
    expect(res.outcomes[0].reason).toMatch(/personal data \(to\)/);
  });
});

// ---------------------------------------------------------------------------

describe('applyFixes — conflicts, emptiness and caps', () => {
  it('abandons a node for the night on a version conflict and never retries', async () => {
    vi.mocked(mutateNodeConfig).mockRejectedValue(
      new VersionConflictError(9, 3) as never,
    );
    const res = await applyFixes([candidate(), candidate({ signature: 'a second one' })], {
      enabled: true,
    });

    expect(mutateNodeConfig).toHaveBeenCalledTimes(1);
    expect(res.outcomes[0].status).toBe('conflict');
    expect(res.outcomes[0].reason).toMatch(/no retry/);
    expect(res.outcomes[1].reason).toMatch(/abandoned for tonight/);
    expect(res.applied).toBe(0);
  });

  it('never overwrites a required field a human already filled in', async () => {
    h.nodeConfigs = { n1: { userPrompt: 'the human wrote this' } };
    const c = candidate({
      fixKind: 'empty-required-field',
      patch: { userPrompt: 'a machine guess' },
      lintIssues: [],
    });
    const res = await applyFixes([c], { enabled: true });

    expect(mutateNodeConfig).not.toHaveBeenCalled();
    expect(res.outcomes[0].reason).toMatch(/already has a value/);
  });

  it('fills a required field that is genuinely empty', async () => {
    h.nodeConfigs = { n1: { userPrompt: '' } };
    lintReturns(2, 1);
    const c = candidate({
      fixKind: 'empty-required-field',
      patch: { userPrompt: '{{input.text}}' },
      lintIssues: [],
    });
    const res = await applyFixes([c], { enabled: true });

    expect(res.applied).toBe(1);
    expect(vi.mocked(mutateNodeConfig).mock.calls[0][0].patch).toEqual({
      userPrompt: '{{input.text}}',
    });
  });

  it('stops at maxAutoFixesTotal', async () => {
    lintReturns(9, 8, 7, 6, 5, 4, 3, 2, 1, 0);
    const many = [1, 2, 3, 4, 5].map((n) => candidate({ signature: `sig ${n}` }));
    const res = await applyFixes(many, {
      enabled: true,
      caps: { maxAutoFixesTotal: 2, maxNodeWritesPerWorkflow: 9, maxWorkflowsMutated: 9 },
    });

    expect(res.applied).toBe(2);
    expect(mutateNodeConfig).toHaveBeenCalledTimes(2);
    expect(res.outcomes[2].reason).toMatch(/cap of 2 fixes/);
  });

  it('stops at maxNodeWritesPerWorkflow', async () => {
    lintReturns(9, 8, 7, 6, 5, 4);
    const many = [1, 2, 3].map((n) => candidate({ signature: `sig ${n}` }));
    const res = await applyFixes(many, { enabled: true, caps: { maxNodeWritesPerWorkflow: 1 } });

    expect(res.applied).toBe(1);
    expect(res.outcomes[1].reason).toMatch(/1 writes on this workflow/);
  });

  it('stops at maxWorkflowsMutated', async () => {
    lintReturns(9, 8, 7, 6, 5, 4);
    h.nodeConfigs = {
      n1: { bogusKey: 'orphan' },
      n2: { bogusKey: 'orphan' },
      n3: { bogusKey: 'orphan' },
    };
    const many = [1, 2, 3].map((n) =>
      candidate({
        workflowId: `w${n}`,
        nodeId: `n${n}`,
        lintIssues: [
          {
            nodeId: `n${n}`,
            nodeLabel: 'x',
            field: 'bogusKey',
            issue: 'Unknown config key "bogusKey". This node type does not read it.',
            severity: 'error',
          },
        ],
      }),
    );
    const res = await applyFixes(many, { enabled: true, caps: { maxWorkflowsMutated: 2 } });

    expect(res.applied).toBe(2);
    expect(res.outcomes[2].reason).toMatch(/cap of 2 workflows/);
  });

  it('keys every outcome the way findings.ts keys the record', async () => {
    const c = candidate();
    const res = await applyFixes([c], { enabled: true });
    expect(res.outcomes[0].findingKey).toBe(findingKey(c.workflowId, c.nodeId, c.signature));
  });
});
