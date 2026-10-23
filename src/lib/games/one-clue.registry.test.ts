import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One Clue end to end: through the live registry (timers, recorder) and, for
// its seven seats, through the API's create door. The roster's sources are
// mocked as `api.server.test.ts` mocks them: six family phones, all with games.
const h = vi.hoisted(() => ({
  emails: ['owner', 'sam', 'kim', 'robin', 'alex', 'jo', 'lee', 'max'].map((n) => `${n}@example.test`),
}));
vi.mock('$lib/server/site-devices', () => ({
  listAllSiteDevices: async () =>
    h.emails.map((ownerEmail) => ({ ownerEmail, revokedAt: null, expiresAt: new Date(1_800_000_000_000) })),
}));
vi.mock('$lib/home/presence/members', () => ({ listMembers: async () => [] }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test' }));
vi.mock('$lib/server/grants', () => ({
  loadMember: async (email: string) => ({ principalId: `u_${email.split('@')[0]}`, grants: new Set(['games:self']) }),
}));
vi.mock('./invite-push.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./invite-push.server')>()),
  pushInvites: async () => {},
}));
vi.mock('./quiz-night.server', () => ({ writeQuiz: async () => {} }));
vi.mock('$lib/jkai/chat-access.server', () => ({ reserveUsage: async () => {} }));

import { isHttpError } from '@sveltejs/kit';
import { _resetRooms, _setRecorder, act, createGame, inviteTo, roomFor } from './rooms.server';
import { startGame } from './api.server';
import { _resetPlayers, playerId } from './players.server';
import { CARDS, CLUE_MS, COUNTDOWN_MS, GRACE_MS, GUESS_MS, REVEAL_MS, type WireRoom } from './one-clue';
import { GAMES, GAME_IDS } from './catalogue';
import { TITLES } from './invite-push.server';
import type { RoundRow } from './results';

const john = { id: 'p_john', name: 'John' };
const sam = { id: 'p_sam', name: 'Sam' };
const kim = { id: 'p_kim', name: 'Kim' };

const recorded: RoundRow[][] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_790_000_000_000);
  recorded.length = 0;
  _resetPlayers();
  _setRecorder(async (rows) => {
    recorded.push(rows);
    return {};
  });
});
afterEach(() => {
  _resetRooms();
  _setRecorder(null);
  vi.useRealTimers();
});

const view = (id: string, who: string) => roomFor(id, who) as unknown as WireRoom;

/** Three in, started, dealt. */
function table(): string {
  const { id } = createGame({ game: 'one-clue', host: john, invite: [sam, kim], difficulty: 'medium' });
  act(id, 'p_sam', 'join');
  act(id, 'p_kim', 'join');
  act(id, 'p_john', 'start');
  vi.advanceTimersByTime(COUNTDOWN_MS);
  return id;
}

describe('one clue through the registry', () => {
  it('is registered, titled, and seats seven', () => {
    expect(GAME_IDS).toContain('one-clue');
    expect(TITLES['one-clue']).toBe('One Clue');
    expect(GAMES['one-clue'].maxPlayers).toBe(7);
  });

  it('plays a card: clues, the guesser sees only the survivors, a right guess scores', () => {
    const id = table();
    const first = view(id, 'p_john');
    expect(first.phase).toBe('clues');
    const guesser = first.guesserId!;
    const givers = ['p_john', 'p_sam', 'p_kim'].filter((p) => p !== guesser);
    const word = view(id, givers[0]).word!;
    expect(word).toBeTruthy();
    expect(view(id, guesser).word).toBeNull();
    expect(JSON.stringify(view(id, guesser))).not.toContain(`"${word}"`);

    act(id, givers[0], 'clue', { text: 'Zigzag', lock: true });
    // Two clue-givers and one writes the word itself: cancelled.
    act(id, givers[1], 'clue', { text: word.toUpperCase(), lock: true });
    // One clue left standing: the other clue-giver may still veto it. Both wave it through.
    expect(view(id, guesser).phase).toBe('review');
    expect(view(id, guesser).clues).toBeNull();
    for (const g of givers) act(id, g, 'done');
    const shown = view(id, guesser);
    expect(shown.phase).toBe('guess');
    expect(shown.clues?.map((c) => c.text)).toEqual(['Zigzag']);
    expect(shown.cancelledCount).toBe(1);
    expect(JSON.stringify(shown)).not.toContain(word.toUpperCase());

    expect(() => act(id, givers[0], 'guess', { text: word })).toThrow(/Only the guesser/);
    const after = act(id, guesser, 'guess', { text: word }) as unknown as WireRoom;
    expect(after.phase).toBe('reveal');
    expect(after.score).toBe(1);
    expect(after.word).toBe(word);
    vi.advanceTimersByTime(REVEAL_MS);
    expect(view(id, 'p_john').cardIndex).toBe(1);
  });

  it('plays itself out on its own timers and records the team score for everyone', () => {
    const id = table();
    // Nobody does anything: each card runs out its clue, guess and reveal clocks.
    for (let i = 0; i < CARDS; i++) vi.advanceTimersByTime(CLUE_MS.medium + GRACE_MS + GUESS_MS + GRACE_MS + REVEAL_MS);
    const done = view(id, 'p_john');
    expect(done.phase).toBe('finished');
    expect(done.cards).toHaveLength(CARDS);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].map((r) => [r.game, r.score, r.rank, r.won])).toEqual([
      ['one-clue', 0, 1, false],
      ['one-clue', 0, 1, false],
      ['one-clue', 0, 1, false],
    ]);
    expect(recorded[0][0].options).toEqual({ label: '10 cards · a team game' });
  });

  it('a lobby invite may fill seven seats, not eight', () => {
    const { id } = createGame({ game: 'one-clue', host: john, invite: [sam], difficulty: 'easy' });
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `p_${i}`, name: `P${i}` }));
    inviteTo(id, 'p_john', five);
    expect(view(id, 'p_john').players).toHaveLength(7);
    expect(() => inviteTo(id, 'p_john', [{ id: 'p_x', name: 'X' }])).toThrow(/Up to 7/);
  });

  it('the API creates a game of seven, and refuses eight', async () => {
    const owner = { email: 'owner@example.test', role: 'owner' as const };
    const others = h.emails.slice(1).map((e) => playerId(e));
    const event = { locals: {} as App.Locals };
    const room = (await startGame(event, owner, { game: 'one-clue', difficulty: 'easy', invite: others.slice(0, 6) })) as unknown as WireRoom;
    expect(room.players).toHaveLength(7);
    try {
      await startGame(event, owner, { game: 'one-clue', difficulty: 'easy', invite: others });
      throw new Error('expected a refusal');
    } catch (err) {
      expect(isHttpError(err) && err.status).toBe(400);
    }
    // Every other game keeps the usual five.
    try {
      await startGame(event, owner, { game: 'categories', difficulty: 'easy', invite: others.slice(0, 5) });
      throw new Error('expected a refusal');
    } catch (err) {
      expect(isHttpError(err) && err.status).toBe(400);
    }
  });
});
