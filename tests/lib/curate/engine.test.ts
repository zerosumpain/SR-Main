import { describe, it, expect, beforeEach } from 'vitest';

// Use test-prefixed IDs and clean up before each run.
beforeEach(async () => {
  const { db } = await import('$lib/db');
  const { curateSessions } = await import('$lib/db/schema');
  const { like } = await import('drizzle-orm');
  await db.delete(curateSessions).where(like(curateSessions.id, 'test-eng-%'));
});

describe('getAllowedTransitions', () => {
  it('returns the correct allowed targets for each status', async () => {
    const { getAllowedTransitions } = await import('$lib/curate/engine');

    expect(getAllowedTransitions('scoping')).toEqual(
      expect.arrayContaining(['discovering', 'aborted']),
    );
    expect(getAllowedTransitions('discovering')).toEqual(
      expect.arrayContaining(['awaiting-approval', 'error', 'aborted']),
    );
    expect(getAllowedTransitions('awaiting-approval')).toEqual(
      expect.arrayContaining(['generating', 'discovering', 'aborted']),
    );
    expect(getAllowedTransitions('generating')).toEqual(
      expect.arrayContaining(['live-testing', 'error']),
    );
    expect(getAllowedTransitions('live-testing')).toEqual(
      expect.arrayContaining(['awaiting-promotion', 'generating', 'aborted']),
    );
    expect(getAllowedTransitions('awaiting-promotion')).toEqual(
      expect.arrayContaining(['promoting', 'aborted']),
    );
    expect(getAllowedTransitions('promoting')).toEqual(
      expect.arrayContaining(['promoted', 'error']),
    );
    expect(getAllowedTransitions('promoted')).toEqual([]);
    expect(getAllowedTransitions('aborted')).toEqual([]);
    expect(getAllowedTransitions('ended')).toEqual([]);
  });
});

describe('transitionStatus', () => {
  it('valid transition: scoping → discovering', async () => {
    const { createSession } = await import('$lib/curate/session-store');
    const { transitionStatus } = await import('$lib/curate/engine');
    const { getSession } = await import('$lib/curate/session-store');

    const id = 'test-eng-1';
    await createSession({ id, targetType: 'apple-calendar' });

    await transitionStatus(id, 'scoping', 'discovering');

    const row = await getSession(id);
    expect(row!.status).toBe('discovering');
  });

  it('transition writes a log entry to iterationLog', async () => {
    const { createSession, getSession } = await import('$lib/curate/session-store');
    const { transitionStatus } = await import('$lib/curate/engine');

    const id = 'test-eng-2';
    await createSession({ id, targetType: 'test-node' });

    await transitionStatus(id, 'scoping', 'discovering');

    const row = await getSession(id);
    expect(Array.isArray(row!.iterationLog)).toBe(true);
    expect((row!.iterationLog as unknown[]).length).toBeGreaterThan(0);

    const entry = (row!.iterationLog as Array<{ from: string; to: string }>)[0];
    expect(entry.from).toBe('scoping');
    expect(entry.to).toBe('discovering');
  });

  it('invalid transition throws and does NOT update status', async () => {
    const { createSession, getSession } = await import('$lib/curate/session-store');
    const { transitionStatus } = await import('$lib/curate/engine');

    const id = 'test-eng-3';
    await createSession({ id, targetType: 'test-node' });

    await expect(transitionStatus(id, 'scoping', 'promoted')).rejects.toThrow();

    const row = await getSession(id);
    expect(row!.status).toBe('scoping'); // unchanged
  });

  it('idempotent same-state call throws (not a valid transition)', async () => {
    const { createSession } = await import('$lib/curate/session-store');
    const { transitionStatus } = await import('$lib/curate/engine');

    const id = 'test-eng-4';
    await createSession({ id, targetType: 'test-node' });

    // scoping → scoping is not listed as an allowed transition
    await expect(transitionStatus(id, 'scoping', 'scoping')).rejects.toThrow();
  });

  it('aborted is reachable from discovering (abort from any active state)', async () => {
    const { createSession, updateSession, getSession } = await import('$lib/curate/session-store');
    const { transitionStatus } = await import('$lib/curate/engine');

    const id = 'test-eng-5';
    await createSession({ id, targetType: 'test-node' });
    await updateSession(id, { status: 'discovering' });

    await transitionStatus(id, 'discovering', 'aborted');

    const row = await getSession(id);
    expect(row!.status).toBe('aborted');
  });
});
