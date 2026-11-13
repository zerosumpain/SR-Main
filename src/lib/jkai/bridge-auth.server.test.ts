import { describe, it, expect, beforeAll, vi } from 'vitest';

// Only the build's status matters to this rule; the row shape is otherwise opaque.
const h = vi.hoisted(() => ({ row: null as null | { id: string; status: string } }));
vi.mock('$lib/db', () => ({
  db: { select: () => ({ from: () => ({ where: async () => (h.row ? [h.row] : []) }) }) },
}));

beforeAll(() => {
  process.env.JKAI_BRIDGE_SECRET = 'x'.repeat(48);
});

const { runningBridgeBuild } = await import('./bridge-auth.server');
const { signBridgeToken } = await import('./bridge-token');

describe('runningBridgeBuild', () => {
  it('admits a valid token for a running build', async () => {
    h.row = { id: 'b1', status: 'running' };
    expect((await runningBridgeBuild(`Bearer ${signBridgeToken('b1')}`))?.id).toBe('b1');
  });

  it('refuses a valid token once the build has stopped', async () => {
    for (const status of ['completed', 'failed', 'paused', 'pending']) {
      h.row = { id: 'b1', status };
      expect(await runningBridgeBuild(`Bearer ${signBridgeToken('b1')}`)).toBeNull();
    }
  });

  it('refuses a token for a build that does not exist, or no token at all', async () => {
    h.row = null;
    expect(await runningBridgeBuild(`Bearer ${signBridgeToken('gone')}`)).toBeNull();
    expect(await runningBridgeBuild(null)).toBeNull();
  });
});
