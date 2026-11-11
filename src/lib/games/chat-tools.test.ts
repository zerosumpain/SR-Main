import { beforeEach, describe, expect, it, vi } from 'vitest';

// The games reads (workflow knit 2026-11-11, slice 3): rooms, one room, and
// the Hometowns leaderboard. Reading must not mark an invite seen, and a room
// never carries a position. Fixtures are synthetic.

const h = vi.hoisted(() => ({ calls: [] as string[] }));
const ROOM = { id: 'room1', game: 'hometowns', phase: 'playing', hostName: 'Synthetic Kid', myTurn: true, waitingFor: ['Synthetic Gran'], dueAt: null };

vi.mock('$lib/server/access', () => ({ getOwnerEmails: () => ['Owner@Example.invalid'] }));
vi.mock('./players.server', () => ({ playerFor: async (email: string) => (h.calls.push(`player:${email}`), { id: 'p1', name: 'Synthetic Owner' }) }));
vi.mock('./rooms.server', () => ({
  hydrateFor: async () => void h.calls.push('hydrate'),
  roomsFor: () => [ROOM, { ...ROOM, id: 'room2', game: 'marbles', myTurn: false }],
}));
vi.mock('./api.server', () => ({
  lobbyFor: async () => {
    throw new Error('the lobby marks invites seen and must not be read from chat');
  },
  roomView: async (_caller: unknown, id: string) => {
    if (id !== 'room1') throw Object.assign(new Error('nope'), { body: { message: 'You are not in that room.' } });
    return {
      id,
      game: 'hometowns',
      phase: 'playing',
      players: [{ name: 'Synthetic Kid', score: 3, lat: 12.345678, lon: -98.765432, position: { lat: 12.345678 }, address: '1 Synthetic Street' }],
      rounds: Array.from({ length: 80 }, (_, i) => ({ n: i, note: 'x'.repeat(500), location: { lat: 12.345678 } })),
    };
  },
  leaderboardFor: async (_caller: unknown, window: string) => ({
    window,
    games: [{ game: 'hometowns', title: 'Hometowns', rows: [{ rank: 1, name: 'Synthetic Kid', best: 9, wins: 2, games: 3, email: 'kid@example.invalid' }] }],
    overall: [{ rank: 1, name: 'Synthetic Kid', wins: 2, played: 3, email: 'kid@example.invalid' }],
  }),
}));

const TIERS: Record<string, [string, string, string]> = {
  games_list: ['read', 'never', 'games'],
  game_state: ['read', 'never', 'games'],
  hometowns_status: ['read', 'never', 'hometowns'],
};

const { tools } = await import('$lib/tools/registry-internal');
await import('./chat-tools');
const { MEMBER_SAFE_TOOLS, tierOf, principalRefusal } = await import('$lib/tools/invoke-contract');
const { MEMBER_FORBIDDEN_TOOLSETS } = await import('$lib/jkai/member-chat/policy');
const { WHATSAPP_READ_TOOLS } = await import('$lib/integrations/whatsapp/tool-whitelist');

const NAMES = Object.keys(TIERS);
const tool = (name: string) => tools.find((t) => t.name === name)!;
const run = (name: string, args: Record<string, unknown> = {}, principalId?: string) => tool(name).handler(args, { emit: () => {}, ...(principalId ? { principalId } : {}) });

function contract(forbidden = true) {
  it('declare their tier, are owner-only, and are off every member and WhatsApp list', async () => {
    for (const name of NAMES) {
      const t = tool(name);
      expect(tools.filter((x) => x.name === name).length, name).toBe(1);
      expect(tierOf(t), name).toEqual({ effect: TIERS[name][0], confirm: TIERS[name][1], lane: 'standard' });
      expect(t.toolset, name).toBe(TIERS[name][2]);
      expect(t.surfaces, name).toEqual(['chat', 'app']);
      expect(MEMBER_SAFE_TOOLS.includes(name), name).toBe(false);
      expect((WHATSAPP_READ_TOOLS as readonly string[]).includes(name), name).toBe(false);
      if (forbidden) expect((MEMBER_FORBIDDEN_TOOLSETS as readonly string[]).includes(t.toolset), name).toBe(true);
      expect(JSON.stringify([t.description, t.parameters]), name).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\b\d{1,2}:\d\d\b/);
      const r = await run(name, {}, 'u_member');
      expect(r.success, name).toBe(false);
      expect(r.error, name).toMatch(/owner/);
      expect(principalRefusal({ principalId: 'u_member', via: 'session', attended: true, jobId: 'j', allowedTools: [name] }, { name, tier: tierOf(t) }), name).toBeTruthy();
      if (TIERS[name][0] !== 'read') {
        expect(principalRefusal({ principalId: 'owner', via: 'heartbeat', attended: false }, { name, tier: tierOf(t) }), name).toBeTruthy();
      }
    }
  });
}

const { compactRoom, ROOM_CAP } = await import('./chat-tools');
const LEAKS = /12\.345678|98\.765432|Synthetic Street|"lat"|"lon"|"position"|"address"|"location"|example\.invalid/i;

describe('games chat tools', () => {
  beforeEach(() => {
    h.calls = [];
  });
  contract();

  it('games_list lists the owner\'s rooms without opening the lobby', async () => {
    const r = await run('games_list');
    expect(r.success, r.error).toBe(true);
    expect(r.data).toMatchObject({ me: 'Synthetic Owner', rooms: [{ id: 'room1', game: 'hometowns', host: 'Synthetic Kid', myTurn: true, waitingFor: ['Synthetic Gran'] }, { id: 'room2' }] });
    expect(h.calls).toEqual(['player:owner@example.invalid', 'hydrate']);
  });

  it('game_state validates the id, cuts the room to the cap and never carries a position', async () => {
    expect((await run('game_state', {})).success).toBe(false);
    expect((await run('game_state', { roomId: '../etc' })).error).toMatch(/roomId/);
    const r = await run('game_state', { roomId: 'room1' });
    expect(r.success, r.error).toBe(true);
    const out = JSON.stringify(r.data);
    expect(out.length).toBeLessThanOrEqual(ROOM_CAP + 40);
    expect(out).not.toMatch(LEAKS);
    expect(out).toMatch(/Synthetic Kid/);
    expect((r.data as { trimmed: boolean }).trimmed).toBe(true);
    const miss = await run('game_state', { roomId: 'other' });
    expect(miss).toMatchObject({ success: false });
    expect(miss.error).toMatch(/not in that room/);
  });

  it('compactRoom leaves a small room alone', () => {
    expect(compactRoom({ id: 'r', players: [{ name: 'A', score: 1, lat: 1 }] })).toEqual({ room: { id: 'r', players: [{ name: 'A', score: 1 }] }, trimmed: false });
  });

  it('hometowns_status keeps only Hometowns rooms and its leaderboard, with no email', async () => {
    const r = await run('hometowns_status', { window: 'nonsense' });
    expect(r.success, r.error).toBe(true);
    expect(r.data).toMatchObject({ window: 'week', rooms: [{ id: 'room1' }], leaderboard: { title: 'Hometowns', rows: [{ rank: 1, name: 'Synthetic Kid', best: 9 }] }, overall: [{ rank: 1, name: 'Synthetic Kid', wins: 2, played: 3 }] });
    expect((r.data as { rooms: unknown[] }).rooms).toHaveLength(1);
    expect(JSON.stringify(r.data)).not.toMatch(LEAKS);
  });
});
