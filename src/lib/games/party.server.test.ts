// Parties at a TV: guests and family join, the TV starts a game that makes an
// ordinary room with everybody in it, kicks and locks hold, and the streams
// carry the party and the room to the TV and to each player.

import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ env: { AUTH_SECRET: 'test-secret-for-parties' } as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('./quiz-night.server', () => ({ writeQuiz: async () => {} }));

import { _resetRooms, roomFor, roomStage } from './rooms.server';
import {
  PARTY_IDLE_MS,
  _resetParties,
  _sweepParties,
  joinFamily,
  joinGuest,
  memberAct,
  memberStream,
  openParty,
  partyByCode,
  partyIdFor,
  seated,
  tvAct,
  tvStream,
} from './party.server';
import { verifySeat } from './party';

const tv = { id: 'tv_0123456789ab', name: 'Living room' };
const john = { id: 'p_0123456789ab', name: 'John' };

type Frame = { type: string; [k: string]: unknown };

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
        buffer += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (line) queue.push(JSON.parse(line.slice(6)) as Frame);
        }
      }
      return queue.shift()!;
    },
    /** The next frame of this type, skipping others. */
    async until(type: string): Promise<Frame> {
      for (;;) {
        const f = await this.next();
        if (f.type === type) return f;
      }
    },
    cancel: () => r.cancel(),
  };
}

afterEach(() => {
  _resetParties();
  _resetRooms();
});

describe('opening a party', () => {
  it('is one party per TV, the same one when asked again', () => {
    const a = openParty(tv);
    const b = openParty(tv);
    expect(b.id).toBe(a.id);
    expect(a.code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}$/u);
    expect(a.joinPath).toBe(`/games/join/${a.code}`);
    expect(a.games.map((g) => g.id)).toContain('boggle');
  });

  it('close gives the TV a fresh party with a new code', () => {
    const a = openParty(tv);
    const b = tvAct(tv.id, 'close');
    expect(b.id).not.toBe(a.id);
    expect(() => partyByCode(a.code)).toThrow(/No TV is showing/u);
  });

  it('an idle party (TV gone half an hour, nothing running) is swept', () => {
    const a = openParty(tv);
    _sweepParties(Date.now() + PARTY_IDLE_MS + 1_000);
    expect(() => partyByCode(a.code)).toThrow();
  });
});

describe('joining', () => {
  it('a guest gets a seat for this party, and is the same member back with it', () => {
    const { code } = openParty(tv);
    const j = joinGuest(code, 'Sam');
    expect(j.memberId).toMatch(/^v_/u);
    expect(verifySeat(j.seat, partyIdFor(code), h.env.AUTH_SECRET)).toBe(j.memberId);
    expect(seated(code, j.memberId).member.name).toBe('Sam');
    expect(partyByCode(code).members).toHaveLength(1);
  });

  it('a second Sam is Sam 2; a bad name is refused with a sentence', () => {
    const { code } = openParty(tv);
    joinGuest(code, 'Sam');
    expect(joinGuest(code, 'sam').party.members.map((m) => m.name)).toEqual(['Sam', 'sam 2']);
    expect(() => joinGuest(code, '')).toThrow(/different name/u);
  });

  it('a family member joins as themselves, once', () => {
    const { code } = openParty(tv);
    joinFamily(code, john);
    const again = joinFamily(code, john);
    expect(again.memberId).toBe(john.id);
    expect(again.party.members).toHaveLength(1);
    expect(again.party.members[0].kind).toBe('family');
  });

  it('a locked party refuses newcomers; unlocking lets them in', () => {
    const { code } = openParty(tv);
    tvAct(tv.id, 'lock');
    expect(() => joinGuest(code, 'Sam')).toThrow(/locked/u);
    tvAct(tv.id, 'unlock');
    expect(joinGuest(code, 'Sam').memberId).toMatch(/^v_/u);
  });

  it('holds eight at most', () => {
    const { code } = openParty(tv);
    for (let i = 1; i <= 8; i++) joinGuest(code, `Guest ${i}`);
    expect(() => joinGuest(code, 'Nine')).toThrow(/full/u);
  });

  it('an unknown code is a 404 sentence', () => {
    expect(() => partyByCode('ZZZZ')).toThrow(/No TV is showing/u);
    expect(() => joinGuest('nope', 'Sam')).toThrow(/No TV is showing/u);
  });
});

describe('playing', () => {
  it('start makes a running room with everybody in it', () => {
    const { code } = openParty(tv);
    const sam = joinGuest(code, 'Sam').memberId;
    joinFamily(code, john);
    tvAct(tv.id, 'pick', { game: 'boggle', options: { seconds: 30, size: 4 } });
    const v = tvAct(tv.id, 'start');
    expect(v.phase).toBe('playing');
    expect(roomStage(v.roomId!)?.phase).toBe('countdown');
    const seen = roomFor(v.roomId!, sam) as unknown as { players: { id: string; status: string }[] };
    expect(seen.players.map((p) => p.status)).toEqual(['joined', 'joined']);
  });

  it('refuses to start with nobody, and says why on the party', () => {
    openParty(tv);
    expect(() => tvAct(tv.id, 'start')).toThrow(/needs/u);
    expect(openParty(tv).notice).toMatch(/needs/u);
  });

  it('a phone may move but not start, and end brings the party back to its lobby', () => {
    const { code } = openParty(tv);
    const sam = joinGuest(code, 'Sam').memberId;
    tvAct(tv.id, 'start');
    expect(() => memberAct(code, sam, 'start')).toThrow(/Unknown action/u);
    const roomId = openParty(tv).roomId!;
    const ended = tvAct(tv.id, 'end');
    expect(ended.phase).toBe('lobby');
    expect(roomStage(roomId)?.phase).toBe('closed');
    expect(() => memberAct(code, sam, 'word', { word: 'cat' })).toThrow(/No game is running/u);
  });

  it('a kicked player is refused everything and cannot come back', () => {
    const { code } = openParty(tv);
    const sam = joinGuest(code, 'Sam').memberId;
    tvAct(tv.id, 'kick', { memberId: sam });
    expect(() => seated(code, sam)).toThrow(/taken out/u);
    expect(() => memberAct(code, sam, 'word', {})).toThrow(/taken out/u);
    expect(partyByCode(code).members).toHaveLength(0);
  });

  it('again starts a fresh room with whoever is here now', () => {
    const { code } = openParty(tv);
    joinGuest(code, 'Sam');
    const first = tvAct(tv.id, 'start').roomId;
    joinGuest(code, 'Alex');
    const second = tvAct(tv.id, 'again').roomId;
    expect(second).not.toBe(first);
    expect(roomStage(first!)?.phase).toBe('closed');
  });
});

describe('streams', () => {
  it('the TV sees the party, then the room table once a game starts', async () => {
    const t = reader(await tvStream(tv));
    const first = await t.until('party');
    const code = (first.party as { code: string }).code;
    joinGuest(code, 'Sam');
    tvAct(tv.id, 'start');
    const room = await t.until('room');
    expect((room.room as { phase: string }).phase).toBe('countdown');
    await t.cancel();
  });

  it('a player sees their own room, and a kick ends their stream', async () => {
    const { code } = openParty(tv);
    const sam = joinGuest(code, 'Sam').memberId;
    const s = reader(memberStream(code, sam));
    await s.until('party');
    tvAct(tv.id, 'start');
    const room = await s.until('room');
    expect((room.room as { phase: string }).phase).toBe('countdown');
    tvAct(tv.id, 'kick', { memberId: sam });
    expect((await s.until('kicked')).type).toBe('kicked');
  });

  it('the TV shows who is online', async () => {
    const { code } = openParty(tv);
    const sam = joinGuest(code, 'Sam').memberId;
    expect(partyByCode(code).members[0].online).toBe(false);
    const s = reader(memberStream(code, sam));
    await s.until('party');
    expect(partyByCode(code).members[0].online).toBe(true);
    await s.cancel();
    expect(partyByCode(code).members[0].online).toBe(false);
  });
});

describe('a kicked guest', () => {
  it('is known as kicked, so the same browser cannot rejoin', async () => {
    const { wasKicked } = await import('./party.server');
    const { code } = openParty(tv);
    const sam = joinGuest(code, 'Sam').memberId;
    expect(wasKicked(code, sam)).toBe(false);
    tvAct(tv.id, 'kick', { memberId: sam });
    expect(wasKicked(code, sam)).toBe(true);
  });
});

describe('games with set-up first', () => {
  it('Codenames opens its lobby on Start, and Go starts play', () => {
    const { code } = openParty(tv);
    joinGuest(code, 'Sam');
    joinGuest(code, 'Alex');
    tvAct(tv.id, 'pick', { game: 'codenames' });
    const v = tvAct(tv.id, 'start');
    expect(roomStage(v.roomId!)?.phase).toBe('lobby');
    tvAct(tv.id, 'go');
    expect(roomStage(v.roomId!)?.phase).toBe('countdown');
  });

  it('Go with nothing waiting is refused', () => {
    openParty(tv);
    expect(() => tvAct(tv.id, 'go')).toThrow(/No game is waiting/u);
  });

  it('a TV may start ten AI quizzes a day', () => {
    const { code } = openParty(tv);
    joinGuest(code, 'Sam');
    tvAct(tv.id, 'pick', { game: 'quiz-night', options: { topic: 'trains' } });
    for (let i = 0; i < 10; i++) tvAct(tv.id, i === 0 ? 'start' : 'again');
    expect(() => tvAct(tv.id, 'again')).toThrow(/limit/u);
  });
});
