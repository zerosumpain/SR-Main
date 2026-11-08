import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ read: vi.fn(), owner: true }));
vi.mock('$lib/selfimprove/backlog-room.server', () => ({ readBacklogRoom: h.read, autoGroomBacklog: vi.fn(() => { throw new Error('a page view must not groom'); }) }));
vi.mock('$lib/server/owner', () => ({ isOwnerRequest: vi.fn(async () => h.owner) }));
vi.mock('$lib/member-view', () => ({ memberBacklog: vi.fn((epics: unknown[]) => ({ epics, board: 'redacted' })) }));

import { load } from './+page.server';

describe('/jkai/develop/backlog load', () => {
  it('reads the owner room with the grooming lane and never applies grooming', async () => {
    h.read.mockResolvedValue({ epics: ['e'], board: 'b' });
    await expect(load({} as never)).resolves.toEqual({ epics: ['e'], board: 'b', error: null, member: false });
    expect(h.read).toHaveBeenCalledWith({ grooming: true });
  });

  it('reads a member room without it', async () => {
    h.owner = false;
    h.read.mockResolvedValue({ epics: ['e'], board: 'b' });
    await expect(load({} as never)).resolves.toMatchObject({ member: true, board: 'redacted' });
    expect(h.read).toHaveBeenLastCalledWith();
  });
});
