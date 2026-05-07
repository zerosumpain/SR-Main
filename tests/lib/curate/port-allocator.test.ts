import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(async () => {
  const { db } = await import('$lib/db');
  const { curateSessions } = await import('$lib/db/schema');
  const { like } = await import('drizzle-orm');
  await db.delete(curateSessions).where(like(curateSessions.id, 'test-port-%'));
});

describe('port-allocator', () => {
  it('allocates the lowest free port in range', async () => {
    const { allocatePort } = await import('$lib/curate/port-allocator');
    const p = await allocatePort('test-port-1');
    expect(p).toBeGreaterThanOrEqual(5180);
    expect(p).toBeLessThanOrEqual(5199);
  });

  it('does not double-assign ports across sessions', async () => {
    const { allocatePort } = await import('$lib/curate/port-allocator');
    const a = await allocatePort('test-port-2a');
    const b = await allocatePort('test-port-2b');
    expect(a).not.toBe(b);
  });

  it('exhausts the pool with a clear error', async () => {
    const { allocatePort } = await import('$lib/curate/port-allocator');
    const ids: string[] = [];
    try {
      for (let i = 0; i < 25; i++) {
        const id = `test-port-3-${i}`;
        ids.push(id);
        await allocatePort(id);
      }
      // Should not reach here.
      expect.unreachable('Pool should have been exhausted');
    } catch (err) {
      expect((err as Error).message).toMatch(/no free curate ports/i);
    }
  });

  it('frees a port when releasePort is called', async () => {
    const { allocatePort, releasePort } = await import('$lib/curate/port-allocator');
    const p = await allocatePort('test-port-4');
    await releasePort('test-port-4');
    // Should be reusable now (might be assigned to next session).
    const p2 = await allocatePort('test-port-4-again');
    expect(p2).toBe(p);
  });
});
