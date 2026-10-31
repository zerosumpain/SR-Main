// TV boards: a waiting screen shows a code, a player pairs it, the stream
// hands over a ticket and the table; a ticket brings the same room back; a
// room that goes sends the screen back to a code.

import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ env: { AUTH_SECRET: 'test-secret-for-screens' } as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('./quiz-night.server', () => ({ writeQuiz: async () => {} }));

import { _resetRooms, act, createGame } from './rooms.server';
import { MAX_WAITING, _resetScreens, _waitingCodes, pairScreen, screenGames, screenStream } from './screens.server';
import { issueScreenTicket, newCode, normaliseCode, verifyScreenTicket } from './screens';

const john = { id: 'p_john', name: 'John' };
const sam = { id: 'p_sam', name: 'Sam' };

type Frame = { type: string; [k: string]: unknown };

/** Read a stream's frames as they come; `next()` waits for the next one. */
function reader(res: Response) {
  const r = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const queue: Frame[] = [];
  return {
    async next(): Promise<Frame> {
      while (!queue.length) {
        const { value, done } = await r.read();
        if (done) throw new Error('stream ended');
        buffer += decoder.decode(value);
        let i: number;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          if (chunk.startsWith('data: ')) queue.push(JSON.parse(chunk.slice(6)));
        }
      }
      return queue.shift()!;
    },
    cancel: () => r.cancel(),
  };
}

function azulRoom() {
  return createGame({ game: 'azul', host: john, invite: [sam], difficulty: 'medium', options: { seed: 3 } });
}

afterEach(() => {
  _resetScreens();
  _resetRooms();
});

describe('codes and tickets', () => {
  it('makes four consonants, never one already showing, and reads back what a phone typed', () => {
    const code = newCode(() => false);
    expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    let n = 0;
    expect(newCode((c) => n++ < 3 && !!c)).toHaveLength(4);
    expect(normaliseCode(' bc-df ')).toBe('BCDF');
    expect(normaliseCode('ABCD')).toBeNull();
    expect(normaliseCode('BCD')).toBeNull();
    expect(normaliseCode(42)).toBeNull();
  });

  it('signs a ticket for one room, refused under another secret, after expiry or tampered', () => {
    const now = 1_800_000_000_000;
    const { ticket } = issueScreenTicket('g_0123456789ab', 's1', now);
    expect(verifyScreenTicket(ticket, 's1', now)).toBe('g_0123456789ab');
    expect(verifyScreenTicket(ticket, 's2', now)).toBeNull();
    expect(verifyScreenTicket(ticket, 's1', now + 13 * 3_600_000)).toBeNull();
    expect(verifyScreenTicket(ticket.replace('g_0123456789ab', 'g_0123456789ac'), 's1', now)).toBeNull();
    expect(verifyScreenTicket('nonsense', 's1', now)).toBeNull();
  });
});

describe('a TV board', () => {
  it('lists the games that have one', () => {
    expect(screenGames()).toEqual(['azul']);
  });

  it('refuses a game with no board', async () => {
    await expect(screenStream('chess', null)).rejects.toMatchObject({ status: 404 });
    await expect(screenStream('nope', null)).rejects.toMatchObject({ status: 404 });
  });

  it('shows a code, is paired by a player, then carries a ticket and the table', async () => {
    const room = azulRoom();
    const s = reader(await screenStream('azul', null));
    const first = await s.next();
    expect(first).toMatchObject({ type: 'code', game: 'azul' });
    const code = first.code as string;
    expect(_waitingCodes()).toEqual([code]);

    expect(() => pairScreen('ZZZZ', room.id)).toThrow(/No TV is showing/);
    pairScreen(code.toLowerCase(), room.id);
    const paired = await s.next();
    expect(paired.type).toBe('paired');
    expect(verifyScreenTicket(paired.ticket as string, h.env.AUTH_SECRET)).toBe(room.id);
    const table = await s.next();
    expect(table.type).toBe('room');
    expect((table.room as { id: string; meId: string }).id).toBe(room.id);
    expect((table.room as { meId: string }).meId).toBe('');
    expect(_waitingCodes()).toEqual([]);

    // A move reaches the screen.
    act(room.id, sam.id, 'join');
    const after = await s.next();
    expect((after.room as { players: { id: string; status: string }[] }).players.find((p) => p.id === sam.id)?.status).toBe('joined');
    await s.cancel();
  });

  it('picks the same room back up from its ticket, and goes back to a code when the room has gone', async () => {
    const room = azulRoom();
    const { ticket } = issueScreenTicket(room.id, h.env.AUTH_SECRET);
    const s = reader(await screenStream('azul', ticket));
    expect((await s.next()).type).toBe('room');
    act(room.id, john.id, 'leave'); // the host leaving the lobby closes it
    expect((await s.next()).type).toBe('room'); // closed
    await s.cancel();

    const gone = issueScreenTicket('g_000000000000', h.env.AUTH_SECRET).ticket;
    const t = reader(await screenStream('azul', gone));
    expect((await t.next()).type).toBe('ended');
    expect((await t.next()).type).toBe('code');
    await t.cancel();
  });

  it('refuses pairing a room of a game with no board, and a screen set up for another game', () => {
    const chess = createGame({ game: 'chess', host: john, invite: [sam], difficulty: 'medium' });
    expect(() => pairScreen('BCDF', chess.id)).toThrow(/no TV board/);
  });

  it('keeps at most MAX_WAITING screens waiting', async () => {
    const streams = [];
    for (let i = 0; i < MAX_WAITING + 3; i++) streams.push(await screenStream('azul', null));
    expect(_waitingCodes().length).toBe(MAX_WAITING);
    await Promise.all(streams.map((r) => r.body!.cancel()));
    expect(_waitingCodes().length).toBe(0);
  });
});
