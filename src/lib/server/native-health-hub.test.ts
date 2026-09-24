import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
let failing = false;

vi.mock('$lib/server/extracted-app', () => ({
  getFromExtracted: vi.fn(async (_app: string, path: string) => {
    calls.push(path);
    if (failing) throw new Error('health down');
    return { generatedAt: '2026-09-24T08:00:00Z', lede: `read ${calls.length}` };
  }),
}));

import { getNativeHealthHub } from './native-health-hub';

beforeEach(() => {
  calls.length = 0;
  failing = false;
});

describe('the health hub for the phone', () => {
  it('reads the digest SR-Health wrote, and passes it through unchanged', async () => {
    const hub = await getNativeHealthHub({ fresh: true });
    expect(calls).toEqual(['/api/health/hub']);
    expect(hub).toEqual({ generatedAt: '2026-09-24T08:00:00Z', lede: 'read 1' });
  });

  it('serves a second read inside the minute from cache, and fresh=1 skips it', async () => {
    await getNativeHealthHub({ fresh: true });
    await getNativeHealthHub();
    expect(calls).toHaveLength(1);
    await getNativeHealthHub({ fresh: true });
    expect(calls).toHaveLength(2);
  });

  it('throws when Health is down, so the route can answer 503', async () => {
    failing = true;
    await expect(getNativeHealthHub({ fresh: true })).rejects.toThrow('health down');
  });
});
