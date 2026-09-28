import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The quiz writer calls the model; here it hands back a fixed set after a tick.
vi.mock('./quiz-night.server', () => ({
  writeQuiz: async (room: import('./quiz-night').Room) => {
    await Promise.resolve();
    const { ready } = await import('./quiz-night');
    ready(
      room,
      {
        title: 'Test',
        questions: Array.from({ length: 6 }, (_, i) => ({
          prompt: `Question ${i}?`,
          options: ['a', 'b', 'c', 'd'],
          answerIndex: 1,
          explain: null,
        })),
      },
      Date.now(),
    );
  },
}));
import { _resetRooms, act, asHttp, createGame, inviteTo, invitesFor, roomFor, roomsFor, subscribe } from './rooms.server';
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
    const { id } = createGame({ game: 'tap-duel', host: john, invite: [sam], difficulty: 'easy' });
    expect(invitesFor('p_sam')).toEqual([
      expect.objectContaining({ roomId: id, hostName: 'John', difficulty: 'easy', players: ['John', 'Sam'] }),
    ]);
    expect(invitesFor('p_john')).toEqual([]);

    const seen: WireRoom[] = [];
    const off = subscribe(id, 'p_sam', (r) => seen.push(r as WireRoom), () => {});
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
    const { id } = createGame({ game: 'tap-duel', host: john, invite: [], difficulty: 'hard' });
    act(id, 'p_john', 'start');
    vi.advanceTimersByTime(COUNTDOWN_MS);
    const r = roomFor(id, 'p_john') as WireRoom;
    vi.advanceTimersByTime(r.round!.closesAt - Date.now());
    expect(roomFor(id, 'p_john').phase).toBe('result');
  });

  it('keeps strangers out and says so with a status', () => {
    const { id } = createGame({ game: 'tap-duel', host: john, invite: [], difficulty: 'easy' });
    expect(() => asHttp(() => roomFor(id, 'p_kit'))).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => asHttp(() => roomFor('g_nope', 'p_john'))).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => asHttp(() => act(id, 'p_john', 'tap', { round: 1, reactionMs: 200 }))).toThrow(
      expect.objectContaining({ status: 409 }),
    );
  });

  it('closes an unstarted lobby, then forgets it and tells the stream', () => {
    const { id } = createGame({ game: 'tap-duel', host: john, invite: [sam], difficulty: 'easy' });
    const gone = vi.fn();
    subscribe(id, 'p_john', () => {}, gone);
    vi.advanceTimersByTime(LOBBY_MS);
    expect(roomFor(id, 'p_john').phase).toBe('closed');
    expect(invitesFor('p_sam')).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(gone).toHaveBeenCalledOnce();
    expect(() => roomFor(id, 'p_john')).toThrow(/finished/);
  });

  it('still tells the room about a round that shut under a late, refused tap', () => {
    const { id } = createGame({ game: 'tap-duel', host: john, invite: [sam], difficulty: 'easy' });
    act(id, 'p_sam', 'join');
    act(id, 'p_john', 'start');
    vi.advanceTimersByTime(COUNTDOWN_MS);
    const seen: WireRoom[] = [];
    subscribe(id, 'p_sam', (r) => seen.push(r as WireRoom), () => {});
    // The window has shut but its timer has not run yet.
    vi.setSystemTime((roomFor(id, 'p_john') as WireRoom).round!.closesAt + 5);
    expect(() => act(id, 'p_john', 'tap', { round: 1, reactionMs: 300 })).toThrow(/round is over/);
    expect(seen.at(-1)!.phase).toBe('result');
  });

  it('refuses every action on a closed room, so nothing keeps it alive', () => {
    const { id } = createGame({ game: 'tap-duel', host: john, invite: [sam], difficulty: 'easy' });
    vi.advanceTimersByTime(LOBBY_MS);
    expect(() => asHttp(() => act(id, 'p_john', 'leave'))).toThrow(expect.objectContaining({ status: 409 }));
    vi.advanceTimersByTime(60_000);
    expect(() => roomFor(id, 'p_john')).toThrow(/finished/);
  });

  it('caps how many games one host can hold open', () => {
    for (let i = 0; i < 3; i++) createGame({ game: 'tap-duel', host: john, invite: [], difficulty: 'easy' });
    expect(() => createGame({ game: 'tap-duel', host: john, invite: [], difficulty: 'easy' })).toThrow(/Finish one/);
  });

  it('hosts Wordle Race through the same verbs, with its own move', () => {
    const { id } = createGame({ game: 'wordle-race', host: john, invite: [sam], difficulty: 'easy' });
    act(id, 'p_sam', 'join');
    act(id, 'p_john', 'start');
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(roomFor(id, 'p_john').phase).toBe('playing');
    expect(() => asHttp(() => act(id, 'p_john', 'guess', { word: 'zzzzz' }))).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => asHttp(() => act(id, 'p_john', 'tap', { round: 1 }))).toThrow(expect.objectContaining({ status: 400 }));
    const after = act(id, 'p_john', 'guess', { word: 'house' }) as unknown as {
      players: { id: string; rows: { word: string | null }[] }[];
    };
    expect(after.players.find((p) => p.id === 'p_john')!.rows).toHaveLength(1);
    // Sam sees John's colours, not his letters.
    const seenBySam = roomFor(id, 'p_sam') as unknown as typeof after;
    expect(seenBySam.players.find((p) => p.id === 'p_john')!.rows[0].word).toBeNull();
  });

  it('writes a quiz while the lobby waits, then plays it', async () => {
    const created = createGame({ game: 'quiz-night', host: john, invite: [sam], difficulty: 'easy', options: { audience: 'kids' } });
    expect((created as unknown as { prep: string }).prep).toBe('writing');
    const seen: Array<{ phase: string; prep: string }> = [];
    subscribe(created.id, 'p_sam', (r) => seen.push(r as unknown as { phase: string; prep: string }), () => {});
    expect(() => asHttp(() => act(created.id, 'p_john', 'start'))).toThrow(expect.objectContaining({ status: 409 }));
    await vi.waitFor(() => expect(seen.at(-1)!.prep).toBe('ready'));
    act(created.id, 'p_sam', 'join');
    act(created.id, 'p_john', 'start');
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(seen.at(-1)!.phase).toBe('question');
    act(created.id, 'p_john', 'answer', { question: 0, choice: 1 });
    act(created.id, 'p_sam', 'answer', { question: 0, choice: 2 });
    expect(seen.at(-1)!.phase).toBe('reveal');
  });

  it('hosts Anagram Blitz, Maths Sprint and Sequence Memory through the same verbs', () => {
    type Wire = Record<string, any>;
    const play = (game: 'anagram-blitz' | 'maths-sprint' | 'sequence-memory') => {
      const { id } = createGame({ game, host: john, invite: [], difficulty: 'easy' });
      act(id, 'p_john', 'start');
      vi.advanceTimersByTime(COUNTDOWN_MS);
      return { id, room: () => roomFor(id, 'p_john') as unknown as Wire };
    };

    const anagram = play('anagram-blitz');
    expect(anagram.room().phase).toBe('playing');
    expect(anagram.room().letters).toHaveLength(7);
    expect(() => asHttp(() => act(anagram.id, 'p_john', 'word', { word: 'zzz' }))).toThrow(
      expect.objectContaining({ status: 400 }),
    );

    const maths = play('maths-sprint');
    const problem = maths.room().me.problem as { index: number; text: string };
    // The phone only ever gets the text; work the answer out the way a player would.
    const value = Function(`return (${problem.text.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')})`)() as number;
    const after = act(maths.id, 'p_john', 'answer', { index: problem.index, value }) as unknown as Wire;
    expect(after.me.score).toBe(1);
    expect(after.me.problem.index).toBe(problem.index + 1);

    const seq = play('sequence-memory');
    const round = seq.room().round as { number: number; steps: { tile: number }[] };
    const survived = act(seq.id, 'p_john', 'attempt', { round: round.number, taps: round.steps.map((x) => x.tile) }) as unknown as Wire;
    expect(['result', 'show']).toContain(survived.phase);
    expect(survived.players[0].alive).toBe(true);
  });

  it('hosts Boggle with the round the host picked, and takes a traced word', () => {
    type Wire = Record<string, any>;
    const { id } = createGame({
      game: 'boggle',
      host: john,
      invite: [],
      difficulty: 'easy',
      options: { size: 5, seconds: 30, scoring: 'every' },
    });
    act(id, 'p_john', 'start');
    vi.advanceTimersByTime(COUNTDOWN_MS);
    const room = roomFor(id, 'p_john') as unknown as Wire;
    expect(room.phase).toBe('playing');
    expect(room.grid).toHaveLength(25);
    expect(room.timeLimitMs).toBe(30_000);
    expect(() => asHttp(() => act(id, 'p_john', 'word', { word: 'zzzz' }))).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    vi.advanceTimersByTime(31_000);
    const done = roomFor(id, 'p_john') as unknown as Wire;
    expect(done.phase).toBe('finished');
    expect(done.possible.words).toBeGreaterThan(0);
    // An easy board is rich: there is something to have missed.
    expect(done.missed.length).toBeGreaterThan(0);
    const [first] = done.missed as { word: string; path: number[] }[];
    expect(first.path.map((i) => done.grid[i]).join('')).toBe(first.word);
  });

  describe('inviting from the lobby', () => {
    const kim = { id: 'p_kim', name: 'Kim' };
    type Seen = { players: { id: string; status: string; sawInvite: boolean }[]; phaseEndsAt: number | null };

    it('asks somebody in after the room opened, in every game', () => {
      for (const game of ['tap-duel', 'wordle-race', 'anagram-blitz', 'maths-sprint', 'sequence-memory', 'boggle'] as const) {
        const { id } = createGame({ game, host: john, invite: [], difficulty: 'easy' });
        const room = inviteTo(id, 'p_john', [sam]) as unknown as Seen;
        expect(room.players.map((p) => [p.id, p.status])).toEqual([['p_john', 'joined'], ['p_sam', 'invited']]);
        expect(invitesFor('p_sam').map((i) => i.roomId)).toContain(id);
        act(id, 'p_sam', 'join');
        _resetRooms();
      }
    });

    it('tells the host when the invite reached the phone', () => {
      const { id } = createGame({ game: 'tap-duel', host: john, invite: [sam], difficulty: 'easy' });
      const seen: Seen[] = [];
      subscribe(id, 'p_john', (r) => seen.push(r as unknown as Seen), () => {});
      expect(seen.at(-1)!.players.find((p) => p.id === 'p_sam')!.sawInvite).toBe(false);
      invitesFor('p_sam');
      expect(seen.at(-1)!.players.find((p) => p.id === 'p_sam')!.sawInvite).toBe(true);
      const count = seen.length;
      invitesFor('p_sam');
      expect(seen.length).toBe(count); // a second poll is not news
    });

    it('re-asks somebody who declined, and leaves the joined alone', () => {
      const { id } = createGame({ game: 'tap-duel', host: john, invite: [sam, kim], difficulty: 'easy' });
      act(id, 'p_sam', 'decline');
      act(id, 'p_kim', 'join');
      const room = inviteTo(id, 'p_john', [sam, kim]) as unknown as Seen;
      expect(room.players.map((p) => p.status)).toEqual(['joined', 'invited', 'joined']);
    });

    it('holds the lobby open long enough to answer a late invite', () => {
      const { id } = createGame({ game: 'tap-duel', host: john, invite: [], difficulty: 'easy' });
      vi.advanceTimersByTime(LOBBY_MS - 10_000);
      const room = inviteTo(id, 'p_john', [sam]) as unknown as Seen;
      expect(room.phaseEndsAt).toBe(Date.now() + 2 * 60_000);
      vi.advanceTimersByTime(60_000);
      expect(roomFor(id, 'p_sam').phase).toBe('lobby');
    });

    it('is the host’s, in the lobby, within the player cap', () => {
      const { id } = createGame({ game: 'tap-duel', host: john, invite: [sam], difficulty: 'easy' });
      expect(() => inviteTo(id, 'p_sam', [kim])).toThrow(expect.objectContaining({ status: 403 }));
      const many = Array.from({ length: 5 }, (_, i) => ({ id: `p_${i}`, name: `P${i}` }));
      expect(() => inviteTo(id, 'p_john', many)).toThrow(expect.objectContaining({ status: 400 }));
      act(id, 'p_john', 'start');
      expect(() => inviteTo(id, 'p_john', [kim])).toThrow(expect.objectContaining({ status: 409 }));
    });
  });
});
