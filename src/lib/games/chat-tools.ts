// src/lib/games/chat-tools.ts
//
// jkai's games reads (workflow knit 2026-11-11, slice 3): the family games in
// the phone app, as the owner's own seat sees them.
//
//   games_list         the rooms the owner is in and whose turn it is
//   game_state         one room as the owner sees it, cut down to fit a reply
//   hometowns_status   the Hometowns rooms and its leaderboard
//
// All three go through `$lib/games/api.server`, the same functions the phone's
// routes call, as the owner's player. A room is the game's own state and some
// games are played on a map, so every result passes `scrubLocation`: no
// position, trail or place leaves, whatever a game stores. Moves, invites and
// starting a game stay in the app.
//
// Rooms are read with `roomsFor`, not the lobby: the lobby's invite read IS
// the delivery (it marks the invite seen for the host), and a chat turn
// looking is not John seeing it on his phone.
//
// Reads, owner-only, not member-safe. Registered from here
// (src/hooks.server.ts imports this module at boot).

import { register } from '$lib/tools/registry-internal';
import { refuseUnlessOwner } from '$lib/tools/tools/owner-only';
import { scrubLocation } from '$lib/tools/tools/location-scrub';
import { getOwnerEmails } from '$lib/server/access';
import { leaderboardFor, roomView, type GameCaller } from './api.server';
import { playerFor } from './players.server';
import { hydrateFor, roomsFor } from './rooms.server';

/** How much of one room a reply carries, as JSON characters. */
export const ROOM_CAP = 6000;
const HOMETOWNS = 'hometowns';
const ROOM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const WINDOWS = ['day', 'week', 'all'] as const;

function owner(): GameCaller | null {
  const email = getOwnerEmails()[0]?.trim().toLowerCase();
  return email ? { email, role: 'owner' } : null;
}
const noOwner = (name: string) => ({ success: false as const, error: `${name} needs the owner address, which is not configured.` });
const failed = (name: string, err: unknown) => {
  const body = (err as { body?: { message?: string } })?.body?.message;
  return { success: false as const, error: `${name} could not be read: ${body ?? (err instanceof Error ? err.message : String(err))}`.slice(0, 300) };
};
const windowOf = (raw: unknown) => ((WINDOWS as readonly string[]).includes(raw as string) ? (raw as string) : 'week');

/** The owner's rooms, as the lobby lists them, without touching his invites. */
async function ownerRooms(caller: GameCaller) {
  const me = await playerFor(caller.email);
  await hydrateFor(me.id);
  return { me, rooms: roomsFor(me.id) };
}

/** A room summary without ids a reply does not need. */
const roomRow = (r: { id: string; game: string; phase: string; hostName: string; pace?: string; myTurn?: boolean; waitingFor?: string[] | null; dueAt?: number | null }) => ({
  id: r.id,
  game: r.game,
  phase: r.phase,
  host: r.hostName,
  ...(r.pace ? { pace: r.pace } : {}),
  ...(r.myTurn !== undefined ? { myTurn: r.myTurn } : {}),
  ...(r.waitingFor?.length ? { waitingFor: r.waitingFor.slice(0, 8) } : {}),
  ...(r.dueAt ? { dueAt: new Date(r.dueAt).toISOString() } : {}),
});

/** One room cut to fit: scrubbed, then trimmed harder until it is under the cap. PURE. */
export function compactRoom(room: unknown, cap = ROOM_CAP): { room: unknown; trimmed: boolean } {
  for (const [maxItems, maxChars, maxDepth] of [[20, 300, 5], [8, 160, 4], [4, 80, 3]] as const) {
    const cut = scrubLocation(room, { maxItems, maxChars, maxDepth });
    if (JSON.stringify(cut ?? null).length <= cap) return { room: cut, trimmed: maxItems !== 20 };
  }
  const top = scrubLocation(room, { maxItems: 0, maxChars: 80, maxDepth: 1 });
  return { room: top, trimmed: true };
}

register({
  name: 'games_list',
  description:
    'The family games John is in (phone app): each room with its game, phase, host, whether it is his turn and who it is waiting for. Use for "whose turn is it", "what games am I in". Invites waiting for him show in the app, where moves and invites are made. Read-only.',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Games',
  toolset: 'games',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (_args, ctx) => {
    const refused = refuseUnlessOwner('games_list', ctx);
    if (refused) return refused;
    const caller = owner();
    if (!caller) return noOwner('games_list');
    try {
      const lobby = await ownerRooms(caller);
      const rooms = lobby.rooms.slice(0, 30).map(roomRow);
      return {
        success: true,
        data: scrubLocation({
          me: lobby.me.name,
          rooms,
          message: rooms.length ? 'Read one room with game_state.' : 'You are not in a game.',
        }),
      };
    } catch (err) {
      return failed('games_list', err);
    }
  },
});

register({
  name: 'game_state',
  description:
    `One games room by its id (from games_list), as John's seat sees it: players, scores, phase and whose turn. Cut to ${ROOM_CAP} characters, and never a position on a map. Only rooms he is in. Read-only.`,
  parameters: {
    type: 'object',
    properties: { roomId: { type: 'string', description: 'The room id, from games_list.' } },
    required: ['roomId'],
  },
  category: 'Games',
  toolset: 'games',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('game_state', ctx);
    if (refused) return refused;
    const id = typeof args.roomId === 'string' ? args.roomId.trim() : '';
    if (!ROOM_ID.test(id)) return { success: false, error: 'roomId is required: the room id from games_list.' };
    const caller = owner();
    if (!caller) return noOwner('game_state');
    try {
      return { success: true, data: compactRoom(await roomView(caller, id)) };
    } catch (err) {
      return failed('game_state', err);
    }
  },
});

register({
  name: 'hometowns_status',
  description:
    'The Hometowns game: the Hometowns rooms John is in (phase, host, whose turn) and its leaderboard for a window (day, week or all): each person\'s best, wins and games. Names and scores only. Read-only.',
  parameters: {
    type: 'object',
    properties: { window: { type: 'string', enum: [...WINDOWS], description: 'Leaderboard window. Default week.' } },
    required: [],
  },
  category: 'Games',
  toolset: 'hometowns',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('hometowns_status', ctx);
    if (refused) return refused;
    const caller = owner();
    if (!caller) return noOwner('hometowns_status');
    try {
      const [lobby, board] = await Promise.all([ownerRooms(caller), leaderboardFor(caller, windowOf(args.window))]);
      const game = board.games.find((g) => g.game === HOMETOWNS);
      return {
        success: true,
        data: scrubLocation({
          rooms: lobby.rooms.filter((r) => r.game === HOMETOWNS).slice(0, 20).map(roomRow),
          window: board.window,
          leaderboard: game ? { title: game.title, rows: game.rows.slice(0, 20) } : null,
          overall: board.overall.slice(0, 10).map((r) => ({ rank: r.rank, name: r.name, wins: r.wins, played: r.played })),
          message: game ? undefined : 'Nobody has finished a Hometowns round in this window.',
        }),
      };
    } catch (err) {
      return failed('hometowns_status', err);
    }
  },
});
