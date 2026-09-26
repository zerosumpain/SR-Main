// The chat guard's pure halves: who is metered, and whose job is whose.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/models/settings', () => ({ getSetting: async () => null }));

let viewer: { kind: 'owner' } | { kind: 'anonymous' } | { kind: 'member'; principalId: string; email: string; grants: ReadonlySet<string> } =
  { kind: 'owner' };
vi.mock('$lib/server/viewer', () => ({ viewerOf: async () => viewer }));

import { CHAT_DAILY_TURNS, chatTurnDecision, requireOwnJob } from './chat-access.server';
import { OWNER_ACCESS } from '$lib/server/area-scope';
import { createJob, cancelJob, cleanOldJobs } from '$lib/workflows/chat/job-store';

const SELF = { level: 'self' as const, own: 'u_a' };
const member = (principalId: string) => ({
  kind: 'member' as const,
  principalId,
  email: `${principalId}@example.com`,
  grants: new Set(['jkai.chat:self']),
});

afterEach(() => {
  viewer = { kind: 'owner' };
  cleanOldJobs(0);
});

describe('chatTurnDecision', () => {
  it('never caps the owner', () => {
    expect(chatTurnDecision(OWNER_ACCESS, 10_000)).toEqual({ ok: true });
  });

  it('lets a member through below the cap and refuses 429 at it', () => {
    expect(chatTurnDecision(SELF, CHAT_DAILY_TURNS - 1)).toEqual({ ok: true });
    const refused = chatTurnDecision(SELF, CHAT_DAILY_TURNS);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.status).toBe(429);
  });

  it('honours a configured cap', () => {
    expect(chatTurnDecision(SELF, 5, 5).ok).toBe(false);
    expect(chatTurnDecision(SELF, 4, 5).ok).toBe(true);
  });
});

async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (err) {
    if (isHttpError(err)) return err.status;
    throw err;
  }
}

describe('requireOwnJob', () => {
  const event = { locals: {} as App.Locals };

  it('gives the owner every job, and a sessionless owner-grade lane too', async () => {
    const a = createJob('member turn', { conversationId: 'c1', principalId: 'u_a' });
    expect(await statusOf(requireOwnJob(event, a.jobId))).toBe(200);
    viewer = { kind: 'anonymous' };
    expect(await statusOf(requireOwnJob(event, a.jobId))).toBe(200);
    cancelJob(a.jobId);
  });

  it("gives a member their own job and 404s anyone else's", async () => {
    const owner = createJob('owner turn', { conversationId: 'c0' });
    const a = createJob('member turn', { conversationId: 'c1', principalId: 'u_a' });
    const b = createJob('other member', { conversationId: 'c2', principalId: 'u_b' });
    viewer = member('u_a');
    expect(await statusOf(requireOwnJob(event, a.jobId))).toBe(200);
    expect(await statusOf(requireOwnJob(event, owner.jobId))).toBe(404);
    expect(await statusOf(requireOwnJob(event, b.jobId))).toBe(404);
    expect(await statusOf(requireOwnJob(event, 'no-such-job'))).toBe(404);
    for (const j of [owner, a, b]) cancelJob(j.jobId);
  });
});
