import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(async () => {
  const { db } = await import('$lib/db');
  const { curateSessions } = await import('$lib/db/schema');
  const { like } = await import('drizzle-orm');
  await db.delete(curateSessions).where(like(curateSessions.id, 'test-store-%'));
});

describe('session-store', () => {
  it('creates and retrieves a session', async () => {
    const { createSession, getSession } = await import('$lib/curate/session-store');
    const id = 'test-store-1';
    await createSession({ id, targetType: 'apple-calendar' });
    const got = await getSession(id);
    expect(got).not.toBeNull();
    expect(got!.targetType).toBe('apple-calendar');
    expect(got!.status).toBe('scoping');
  });

  it('listActiveSessions excludes terminal-status rows', async () => {
    const { createSession, updateSession, listActiveSessions } = await import('$lib/curate/session-store');
    await createSession({ id: 'test-store-2a', targetType: 'a' });
    await createSession({ id: 'test-store-2b', targetType: 'b' });
    await updateSession('test-store-2b', { status: 'promoted', promotedAt: new Date() });
    const active = await listActiveSessions();
    const ids = active.map((s) => s.id);
    expect(ids).toContain('test-store-2a');
    expect(ids).not.toContain('test-store-2b');
  });

  it('updateSession patches fields', async () => {
    const { createSession, updateSession, getSession } = await import('$lib/curate/session-store');
    await createSession({ id: 'test-store-3', targetType: 'x' });
    await updateSession('test-store-3', {
      status: 'discovering',
      goal: 'Connect to Apple Calendar',
    });
    const got = await getSession('test-store-3');
    expect(got!.status).toBe('discovering');
    expect(got!.goal).toBe('Connect to Apple Calendar');
  });

  it('markEnded sets status=ended + endedAt', async () => {
    const { createSession, markEnded, getSession } = await import('$lib/curate/session-store');
    await createSession({ id: 'test-store-4', targetType: 'x' });
    await markEnded('test-store-4');
    const got = await getSession('test-store-4');
    expect(got!.status).toBe('ended');
    expect(got!.endedAt).toBeTruthy();
  });
});
