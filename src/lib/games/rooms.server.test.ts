import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetRooms, act, asHttp, createGame, invitesFor, roomFor, roomsFor, subscribe } from './rooms.server';
import { COUNTDOWN_MS, LOBBY_MS, RESULT_MS, type WireRoom } from './tap-duel';

const john = { id: 'p_john', name: 'John' };
const sam = { id: 'p_sam', name: 'Sam' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_790_000_000_000);
});
afterEach(() => {
  _resetRooms();
  vi.useRealTimers();
});

describe('rooms', () => {
  it('offers the invite, then plays a round on its own clock', () => {
    const { id } = createGame({ host: john, invite: [sam], difficulty: 'easy' });
    expect(invitesFor('p_sam')).toEqual([
      expect.objectContaining({ roomId: id, hostName: 'John', difficulty: 'easy', players: ['John', 'Sam'] }),
    ]);
    expect(invitesFor('p_john')).toEqual([]);

    const seen: WireRoom[] = [];
    const off = subscribe(id, 'p_sam', (r) => seen.push(r), () => {});
    expect(seen.at(-1)!.phase).toBe('lobby');

    act(id, 'p_sam', 'join');
    expect(invitesFor('p_sam')).toEqual([]);
    expect(roomsFor('p_sam')).toEqual([{ id, game: 'tap-duel', phase: 'lobby', hostName: 'John' }]);

    act(id, 'p_john', 'start');
    expect(seen.at(-1)!.phase).toBe('countdown');

    vi.advanceTimersByTime(COUNTDOWN_MS);
    const armed = seen.at(-1)!;
    expect(armed.phase).toBe('armed');
    expect(armed.meId).toBe('p_sam');
    expect(armed.round!.goAt).toBeGreaterThan(Date.now());

    act(id, 'p_john', 'tap', { round: 1, reactionMs: 300, early: false });
    act(id, 'p_sam', 'tap', { round: 1, reactionMs: 250, early: false });
    expect(seen.at(-1)!.phase).toBe('result');
    expect(seen.at(-1)!.round!.winnerId).toBe('p_sam');

    vi.advanceTimersByTime(RESULT_MS);
    expect(seen.at(-1)!.round!.number).toBe(2);
    off();
  });

  it('settles a round nobody answers when its window shuts', () => {
    const { id } = createGame({ host: john, invite: [], difficulty: 'hard' });
    act(id, 'p_john', 'start');
    vi.advanceTimersByTime(COUNTDOWN_MS);
    const r = roomFor(id, 'p_john');
    vi.advanceTimersByTime(r.round!.closesAt - Date.now());
    expect(roomFor(id, 'p_john').phase).toBe('result');
  });

  it('keeps strangers out and says so with a status', () => {
    const { id } = createGame({ host: john, invite: [], difficulty: 'easy' });
    expect(() => asHttp(() => roomFor(id, 'p_kit'))).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => asHttp(() => roomFor('g_nope', 'p_john'))).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => asHttp(() => act(id, 'p_john', 'tap', { round: 1, reactionMs: 200 }))).toThrow(
      expect.objectContaining({ status: 409 }),
    );
  });

  it('closes an unstarted lobby, then forgets it and tells the stream', () => {
    const { id } = createGame({ host: john, invite: [sam], difficulty: 'easy' });
    const gone = vi.fn();
    subscribe(id, 'p_john', () => {}, gone);
    vi.advanceTimersByTime(LOBBY_MS);
    expect(roomFor(id, 'p_john').phase).toBe('closed');
    expect(invitesFor('p_sam')).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(gone).toHaveBeenCalledOnce();
    expect(() => roomFor(id, 'p_john')).toThrow(/finished/);
  });

  it('caps how many games one host can hold open', () => {
    for (let i = 0; i < 3; i++) createGame({ host: john, invite: [], difficulty: 'easy' });
    expect(() => createGame({ host: john, invite: [], difficulty: 'easy' })).toThrow(/Finish one/);
  });
});
