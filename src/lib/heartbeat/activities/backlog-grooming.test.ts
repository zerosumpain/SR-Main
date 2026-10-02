import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ autoGroom: vi.fn() }));
vi.mock('$lib/selfimprove/backlog-room.server', () => ({ autoGroomBacklog: h.autoGroom }));

import { backlogGrooming } from './backlog-grooming';
import { getHandler } from '../registry';

describe('backlog-grooming heartbeat activity', () => {
  it('is registered, so the heartbeat seeds and drives it', () => {
    expect(getHandler('backlog-grooming')).toBe(backlogGrooming);
    expect(backlogGrooming.defaultEnabled).toBe(true);
    expect(backlogGrooming.defaultCadenceSeconds).toBe(600);
  });

  it('runs the locked automatic pass and reports what it applied and what waits for the owner', async () => {
    h.autoGroom.mockResolvedValue({ epics: [{ suggestions: [{}, {}] }, { suggestions: [] }], board: {}, applied: 3 });
    const result = await backlogGrooming.run({ now: 0, config: {}, action: {} as never });
    expect(h.autoGroom).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ outcome: 'ok', details: { epics: 2, applied: 3, pending: 2 } });
  });
});
