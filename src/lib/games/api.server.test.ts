import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The roster's sources: one paired phone (Sam's), the owner, and a member who
// has games access but no phone until a test pairs one (Kit). Grants are read
// per email.
const h = vi.hoisted(() => ({
  devices: [] as { ownerEmail: string; revokedAt: Date | null; expiresAt: Date }[],
  grants: new Map<string, string[]>(),
  pushed: [] as string[],
}));

vi.mock('$lib/server/site-devices', () => ({ listAllSiteDevices: async () => h.devices }));
vi.mock('$lib/home/presence/members', () => ({ listMembers: async () => [] }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test' }));
vi.mock('$lib/server/grants', () => ({
  loadMember: async (email: string) => {
    const g = h.grants.get(email);
    return g ? { principalId: `u_${email.split('@')[0]}`, grants: new Set(g) } : null;
  },
}));
vi.mock('./invite-push.server', () => ({ pushInvites: async (id: string) => void h.pushed.push(id) }));
vi.mock('./quiz-night.server', () => ({ writeQuiz: async () => {} }));
vi.mock('$lib/jkai/chat-access.server', () => ({ reserveUsage: async () => {} }));

import { isHttpError } from '@sveltejs/kit';
import { lobbyFor, roomAct, roomStream, roomView, startGame } from './api.server';
import { _resetPlayers, playerId } from './players.server';
import { _resetRooms } from './rooms.server';
import { COUNTDOWN_MS } from './liars-dice';
import type { WireRoom } from './liars-dice';

const owner = { email: 'owner@example.test', role: 'owner' as const };
const sam = { email: 'sam@example.test', role: 'member' as const };
const kit = { email: 'kit@example.test', role: 'member' as const };
const event = { locals: {} as App.Locals };

async function refusal(p: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await p;
  } catch (err) {
    if (isHttpError(err)) return { status: err.status, message: err.body.message };
    throw err;
  }
  throw new Error('expected a refusal');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_790_000_000_000);
  h.devices = [
    { ownerEmail: 'owner@example.test', revokedAt: null, expiresAt: new Date(1_800_000_000_000) },
    { ownerEmail: 'sam@example.test', revokedAt: null, expiresAt: new Date(1_800_000_000_000) },
  ];
  h.grants = new Map([
    ['sam@example.test', ['games:self']],
    ['kit@example.test', ['games:self']],
    ['guest@example.test', ['news:self']],
  ]);
  h.pushed = [];
  _resetPlayers();
});
afterEach(() => {
  _resetRooms();
  vi.useRealTimers();
});

describe('the roster', () => {
  it('offers only people with a live paired phone', async () => {
    expect((await lobbyFor(owner)).players.map((p) => p.name)).toEqual(['Sam']);

    h.devices.push({ ownerEmail: kit.email, revokedAt: null, expiresAt: new Date(1_800_000_000_000) });
    _resetPlayers();
    expect((await lobbyFor(owner)).players.map((p) => p.name)).toEqual(['Kit', 'Sam']);
  });

  it('never offers somebody without games access, even with a paired phone', async () => {
    h.devices.push({ ownerEmail: 'guest@example.test', revokedAt: null, expiresAt: new Date(1_800_000_000_000) });
    _resetPlayers();
    expect((await lobbyFor(owner)).players.map((p) => p.name)).toEqual(['Sam']);
  });
});

describe("a Liar's Dice table between two paired phones", () => {
  it('derives the player id from the email', async () => {
    const lobby = await lobbyFor(kit);
    expect(lobby.me.id).toBe(playerId(kit.email));
  });

  it('starts, invites, joins and plays a bid', async () => {
    h.devices.push({ ownerEmail: kit.email, revokedAt: null, expiresAt: new Date(1_800_000_000_000) });
    const kitId = playerId(kit.email);
    const created = (await startGame(event, owner, { game: 'liars-dice', difficulty: 'medium', dice: 3, invite: [kitId] })) as WireRoom;
    expect(created.dicePerPlayer).toBe(3);
    expect(h.pushed).toEqual([created.id]);

    // Kit's lobby poll carries the invite.
    const invites = (await lobbyFor(kit)).invites;
    expect(invites.map((i) => i.roomId)).toEqual([created.id]);

    await roomAct(kit, created.id, { action: 'join' });
    await roomAct(owner, created.id, { action: 'start' });
    vi.advanceTimersByTime(COUNTDOWN_MS + 10);

    const mine = (await roomView(owner, created.id)) as WireRoom;
    expect(mine.phase).toBe('bidding');
    expect(mine.turnId).toBe(playerId(owner.email));
    // My dice, never Kit's.
    expect(mine.players.find((p) => p.id === kitId)?.dice).toBeNull();
    expect(mine.players.find((p) => p.id === mine.meId)?.dice).toHaveLength(3);

    // Illegal: ones are wild on medium. The rules module's sentence comes back.
    expect(await refusal(roomAct(owner, created.id, { action: 'bid', quantity: 1, face: 1 }))).toEqual({
      status: 400,
      message: 'Ones are wild — bid on 2 to 6.',
    });
    // Off-turn.
    expect((await refusal(roomAct(kit, created.id, { action: 'bid', quantity: 1, face: 3 }))).status).toBe(409);

    const after = (await roomAct(owner, created.id, { action: 'bid', quantity: 2, face: 4 })) as WireRoom;
    expect(after.bid).toMatchObject({ quantity: 2, face: 4 });
    expect(after.turnId).toBe(kitId);
    const called = (await roomAct(kit, created.id, { action: 'liar' })) as WireRoom;
    expect(called.phase).toBe('reveal');
  });

  it('creates a Draw & Guess room with its options', async () => {
    const room = (await startGame(event, owner, {
      game: 'draw-guess',
      difficulty: 'medium',
      turnsEach: 2,
      seconds: 60,
      invite: [playerId(sam.email)],
    })) as unknown as { game: string; turnsEach: number; timeLimitMs: number; players: { id: string; status: string }[] };
    expect(room.game).toBe('draw-guess');
    expect(room.turnsEach).toBe(2);
    expect(room.timeLimitMs).toBe(60_000);
    expect(room.players.find((p) => p.id === playerId(sam.email))?.status).toBe('invited');
    expect(h.pushed).toEqual([(room as unknown as { id: string }).id]);
  });

  it('refuses an invitee who is not on the roster', async () => {
    expect((await refusal(startGame(event, owner, { game: 'liars-dice', difficulty: 'easy', invite: ['p_nobody'] }))).message).toBe(
      'One of those players cannot be invited.',
    );
  });

  it('keeps a room from anyone not in it', async () => {
    const room = await startGame(event, owner, { game: 'liars-dice', difficulty: 'easy' });
    expect((await refusal(roomView(sam, room.id))).status).toBe(403);
    expect((await refusal(roomStream(sam, room.id))).status).toBe(403);
    expect((await refusal(roomView(owner, 'g_missing'))).status).toBe(404);
  });

  it('streams the room as SSE frames', async () => {
    const room = await startGame(event, owner, { game: 'liars-dice', difficulty: 'easy' });
    const res = await roomStream(owner, room.id);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toMatch(/^data: \{"type":"room","room":\{"id":"g_/);
    await reader.cancel();
  });
});
