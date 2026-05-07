import { describe, it, expect, beforeEach } from 'vitest';
import { appleCalendarSpec } from '../../__fixtures__/curate-codegen/apple-calendar.spec';

// ── DB cleanup ───────────────────────────────────────────────────────────

beforeEach(async () => {
  const { db } = await import('$lib/db');
  const { curateSessions } = await import('$lib/db/schema');
  const { like } = await import('drizzle-orm');
  await db.delete(curateSessions).where(like(curateSessions.id, 'test-lt-%'));
});

// ── DB seeder ────────────────────────────────────────────────────────────

// Each test gets a unique port so the curate_sessions_port_uniq constraint
// is satisfied. Tests use ports 5800–5899 (well outside CURATE_PORT_MIN-MAX).
let nextPort = 5800;

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
    status: 'live-testing',
    goal: 'Test live-test runner',
    nodeSpec: appleCalendarSpec as unknown as Record<string, unknown>,
    worktreePath: '/tmp/fake-wt',
    branchName: `curate/${id}`,
    devServerPort: nextPort++,
    iterationLog: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

// ── Mock fetch factory ──────────────────────────────────────────────────
// In v1, fetchFn is accepted but unused (option-c path). These mocks are
// here to document the intended future option-a interface and to confirm
// the function signature accepts a fetchFn without error.

function makeMockFetch(responseBody: unknown): typeof fetch {
  return async (_url: Parameters<typeof fetch>[0], _init?: RequestInit): Promise<Response> => {
    return {
      ok: true,
      status: 200,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    } as Response;
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('runTestCases', () => {
  it('returns one result per llmExample in the spec', async () => {
    await seedSession('test-lt-1');

    const { runTestCases } = await import('$lib/curate/live-test');
    const results = await runTestCases('test-lt-1', { fetchFn: makeMockFetch({}) });

    // apple-calendar fixture has 2 llmExamples.
    expect(results).toHaveLength(appleCalendarSpec.llmExamples.length);
  });

  it('each result has the correct scenario and pending output', async () => {
    await seedSession('test-lt-2');

    const { runTestCases } = await import('$lib/curate/live-test');
    const results = await runTestCases('test-lt-2');

    for (const result of results) {
      expect(result.output).toBe('pending');
      expect(result.ok).toBeNull();
      expect(typeof result.scenario).toBe('string');
      expect(result.scenario.length).toBeGreaterThan(0);
    }
  });

  it('preserves the config from each example', async () => {
    await seedSession('test-lt-3');

    const { runTestCases } = await import('$lib/curate/live-test');
    const results = await runTestCases('test-lt-3');

    // First example: List events in the next 7 days.
    expect(results[0].config).toMatchObject({ operation: 'list' });
    // Second example: Create a 1-hour event.
    expect(results[1].config).toMatchObject({ operation: 'create' });
  });

  it('appends a live-test log entry to iterationLog', async () => {
    await seedSession('test-lt-4');

    const { runTestCases } = await import('$lib/curate/live-test');
    await runTestCases('test-lt-4');

    const { getSession } = await import('$lib/curate/session-store');
    const row = await getSession('test-lt-4');
    const log = row!.iterationLog as Array<{ phase: string; results: unknown[] }>;
    const entry = log.find((e) => e.phase === 'live-test');
    expect(entry).toBeDefined();
    expect(entry!.results).toHaveLength(appleCalendarSpec.llmExamples.length);
  });

  it('does NOT auto-judge ok — ok is always null', async () => {
    await seedSession('test-lt-5');

    const { runTestCases } = await import('$lib/curate/live-test');
    const results = await runTestCases('test-lt-5');

    for (const r of results) {
      expect(r.ok).toBeNull();
    }
  });

  it('throws if session is not found', async () => {
    const { runTestCases } = await import('$lib/curate/live-test');
    await expect(runTestCases('test-lt-missing')).rejects.toThrow('not found');
  });

  it('handles a spec with no llmExamples gracefully', async () => {
    const specNoExamples = { ...appleCalendarSpec, llmExamples: [] };
    await seedSession('test-lt-6', {
      nodeSpec: specNoExamples as unknown as Record<string, unknown>,
    });

    const { runTestCases } = await import('$lib/curate/live-test');
    const results = await runTestCases('test-lt-6');

    expect(results).toHaveLength(0);
  });
});
