import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./quiz-night.server', () => ({ writeQuiz: async () => {} }));
vi.mock('./players.server', () => ({
  gamePlayers: async () => [
    { id: 'p_john', email: 'john@example.test', name: 'John' },
    { id: 'p_sam', email: 'sam@example.test', name: 'Sam' },
    { id: 'p_robin', email: 'robin@example.test', name: 'Robin' },
  ],
}));
vi.mock('$lib/server/push-devices', () => ({ pushToEmails: vi.fn() }));

const { _resetRooms, act, createGame, inviteTo, invitesFor } = await import('./rooms.server');
const { inviteMessage, nameList, pushInvites } = await import('./invite-push.server');

const john = { id: 'p_john', name: 'John' };
const sam = { id: 'p_sam', name: 'Sam' };
const robin = { id: 'p_robin', name: 'Robin' };

/** A push that reaches whoever is in `phones`. */
const reaching = (...phones: string[]) =>
  vi.fn(async (emails: readonly string[]) => ({
    reached: new Set(emails.filter((e) => phones.includes(e))),
    sent: 0,
    failed: 0,
  }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_790_000_000_000);
});
afterEach(() => {
  _resetRooms();
  vi.useRealTimers();
});

describe('the invite banner', () => {
  it('reads as the app words its own, and is time-sensitive', () => {
    const m = inviteMessage(
      { roomId: 'g_1', game: 'wordle-race', difficulty: 'easy', about: null, hostName: 'John', players: ['John', 'Sam', 'Robin'], expiresAt: null },
    );
    expect(m.title).toBe('John invited you to Wordle Race');
    expect(m.body).toBe('Easy, with John, Sam and Robin. Tap to join.');
    expect(m).toMatchObject({ category: 'game', level: 'time-sensitive', collapseId: 'game-g_1' });
    expect(m.userInfo).toEqual({ roomId: 'g_1', game: 'wordle-race', category: 'game' });
  });

  it('lists names like the app', () => {
    expect(nameList(['Sam'])).toBe('Sam');
    expect(nameList(['Sam', 'Robin'])).toBe('Sam and Robin');
  });
});

describe('pushInvites', () => {
  it('pushes each invitee once, and flags the invite for the phones it reached', async () => {
    const { id } = createGame({ game: 'tap-duel', host: john, invite: [sam, robin], difficulty: 'easy' });
    const push = reaching('sam@example.test');
    expect(await pushInvites(id, push)).toBe(1);
    expect(push.mock.calls[0][0]).toEqual(['sam@example.test', 'robin@example.test']);
    expect(invitesFor('p_sam')[0].pushed).toBe(true);
    // Robin's phone took no push: the poll still rings for him.
    expect(invitesFor('p_robin')[0].pushed).toBe(false);

    // A second pass asks only for Robin.
    const again = reaching();
    await pushInvites(id, again);
    expect(again.mock.calls[0][0]).toEqual(['robin@example.test']);
  });

  it('never pushes the host, and pushes nobody for a room with no invitees', async () => {
    const { id } = createGame({ game: 'tap-duel', host: john, invite: [], difficulty: 'easy' });
    const push = reaching('john@example.test');
    expect(await pushInvites(id, push)).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('rings somebody asked back in after declining', async () => {
    const { id } = createGame({ game: 'tap-duel', host: john, invite: [sam], difficulty: 'easy' });
    await pushInvites(id, reaching('sam@example.test'));
    act(id, 'p_sam', 'decline');
    inviteTo(id, 'p_john', [sam]);
    expect(invitesFor('p_sam')[0].pushed).toBe(false);
    const push = reaching('sam@example.test');
    expect(await pushInvites(id, push)).toBe(1);
  });
});
