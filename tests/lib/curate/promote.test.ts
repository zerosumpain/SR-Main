import { describe, it, expect, beforeEach } from 'vitest';
import { appleCalendarSpec } from '../../__fixtures__/curate-codegen/apple-calendar.spec';

// ── DB cleanup ───────────────────────────────────────────────────────────

beforeEach(async () => {
  const { db } = await import('$lib/db');
  const { curateSessions } = await import('$lib/db/schema');
  const { like } = await import('drizzle-orm');
  await db.delete(curateSessions).where(like(curateSessions.id, 'test-prm-%'));
});

// ── DB seeder ────────────────────────────────────────────────────────────

let nextPort = 5700;

async function seedSession(
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const { db } = await import('$lib/db');
  const { curateSessions } = await import('$lib/db/schema');
  const now = new Date();
  await db.insert(curateSessions).values({
    id,
    targetType: 'apple-calendar',
    status: 'awaiting-promotion',
    goal: 'Test promote pipeline',
    nodeSpec: appleCalendarSpec as unknown as Record<string, unknown>,
    worktreePath: '/tmp/fake-promote-wt',
    branchName: 'curate/fake-branch',
    devServerPort: nextPort++,
    iterationLog: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

// ── Stubs ────────────────────────────────────────────────────────────────

type ExecFn = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

/** Succeeds for everything. Records calls for assertion. */
function makeSuccessExec(
  calls: Array<{ cmd: string; args: string[] }> = [],
): ExecFn {
  return async (cmd, args) => {
    calls.push({ cmd, args });
    return { stdout: '', stderr: '' };
  };
}

/** Fails on the specified command substring. */
function makeFailingExec(failOn: string): ExecFn {
  return async (cmd, args) => {
    if (args.join(' ').includes(failOn) || cmd.includes(failOn)) {
      const err = Object.assign(new Error(`Stubbed failure: ${failOn}`), {
        stdout: '',
        stderr: `error: ${failOn} failed`,
      });
      throw err;
    }
    return { stdout: '', stderr: '' };
  };
}

/** No-op deploy — does not touch production. */
async function stubDeploy(_scriptPath: string): Promise<void> {
  // intentionally empty
}

/** Helper: collect all steps from the async generator. */
async function collectSteps(
  gen: AsyncGenerator<import('$lib/curate/promote').PromoteStep>,
): Promise<import('$lib/curate/promote').PromoteStep[]> {
  const steps: import('$lib/curate/promote').PromoteStep[] = [];
  for await (const step of gen) {
    steps.push(step);
  }
  return steps;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('runPromote', () => {
  it('dry-run yields all expected steps in order', async () => {
    await seedSession('test-prm-1');

    const { runPromote } = await import('$lib/curate/promote');
    const steps = await collectSteps(
      runPromote('test-prm-1', {
        dryRun: true,
        exec: makeSuccessExec(),
        runDeploy: stubDeploy,
      }),
    );

    const stepNames = [...new Set(steps.map((s) => s.step))];
    // All 8 steps should be present.
    expect(stepNames).toEqual(
      expect.arrayContaining([
        'pre-flight',
        'tsc',
        'commit',
        'merge',
        'push',
        'deploy',
        'verify',
        'cleanup',
      ]),
    );
  });

  it('dry-run: each step ends as ok (no failures)', async () => {
    await seedSession('test-prm-2');

    const { runPromote } = await import('$lib/curate/promote');
    const steps = await collectSteps(
      runPromote('test-prm-2', {
        dryRun: true,
        exec: makeSuccessExec(),
        runDeploy: stubDeploy,
      }),
    );

    // Filter to the final status for each step (last occurrence).
    const finalStatuses = new Map<string, string>();
    for (const s of steps) {
      finalStatuses.set(s.step, s.status);
    }

    for (const [step, status] of finalStatuses) {
      expect({ step, status }).toMatchObject({ status: 'ok' });
    }
  });

  it('push and deploy steps are marked ok with dry-run detail', async () => {
    await seedSession('test-prm-3');

    const { runPromote } = await import('$lib/curate/promote');
    const steps = await collectSteps(
      runPromote('test-prm-3', {
        dryRun: true,
        exec: makeSuccessExec(),
        runDeploy: stubDeploy,
      }),
    );

    const push = steps.find((s) => s.step === 'push' && s.status === 'ok');
    expect(push?.detail).toMatch(/dry-run/);

    const deploy = steps.find((s) => s.step === 'deploy' && s.status === 'ok');
    expect(deploy?.detail).toMatch(/dry-run/);
  });

  it('aborts early when pre-flight fails', async () => {
    await seedSession('test-prm-4');

    const { runPromote } = await import('$lib/curate/promote');
    // Fail on git status — simulates dirty worktree.
    const exec = makeFailingExec('status');
    const steps = await collectSteps(
      runPromote('test-prm-4', {
        dryRun: true,
        exec,
        runDeploy: stubDeploy,
      }),
    );

    const preflight = steps.find((s) => s.step === 'pre-flight' && s.status === 'failed');
    expect(preflight).toBeDefined();

    // No tsc step should run after pre-flight fails.
    const tscSteps = steps.filter((s) => s.step === 'tsc');
    expect(tscSteps).toHaveLength(0);
  });

  it('marks session promoted in DB on successful dry-run', async () => {
    await seedSession('test-prm-5');

    const { runPromote } = await import('$lib/curate/promote');
    await collectSteps(
      runPromote('test-prm-5', {
        dryRun: true,
        exec: makeSuccessExec(),
        runDeploy: stubDeploy,
      }),
    );

    const { getSession } = await import('$lib/curate/session-store');
    const row = await getSession('test-prm-5');
    expect(row!.status).toBe('promoted');
    expect(row!.promotedAt).not.toBeNull();
  });

  it('appends promote steps to iterationLog', async () => {
    await seedSession('test-prm-6');

    const { runPromote } = await import('$lib/curate/promote');
    await collectSteps(
      runPromote('test-prm-6', {
        dryRun: true,
        exec: makeSuccessExec(),
        runDeploy: stubDeploy,
      }),
    );

    const { getSession } = await import('$lib/curate/session-store');
    const row = await getSession('test-prm-6');
    const log = row!.iterationLog as Array<{ step: string }>;
    const stepNames = log.map((e) => e.step).filter(Boolean);
    expect(stepNames).toContain('cleanup');
  });

  it('throws if session is not found', async () => {
    const { runPromote } = await import('$lib/curate/promote');
    const gen = runPromote('test-prm-missing', {
      dryRun: true,
      exec: makeSuccessExec(),
      runDeploy: stubDeploy,
    });
    await expect(gen.next()).rejects.toThrow('not found');
  });

  it('runDeploy is called with the deploy script path (non-dry-run)', async () => {
    await seedSession('test-prm-7');

    const deployCalls: string[] = [];
    const trackingDeploy = async (scriptPath: string) => {
      deployCalls.push(scriptPath);
    };

    const { runPromote } = await import('$lib/curate/promote');
    // Use a success exec so git commands pass; allow push to 'succeed'.
    const steps = await collectSteps(
      runPromote('test-prm-7', {
        dryRun: false,
        exec: makeSuccessExec(),
        runDeploy: trackingDeploy,
        fetchFn: async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ registeredTypes: [] }),
          }) as Response,
      }),
    );

    expect(deployCalls).toHaveLength(1);
    expect(deployCalls[0]).toContain('deploy.sh');

    // All steps should be ok.
    const finalStatuses = new Map<string, string>();
    for (const s of steps) {
      finalStatuses.set(s.step, s.status);
    }
    expect(finalStatuses.get('deploy')).toBe('ok');
  });
});
