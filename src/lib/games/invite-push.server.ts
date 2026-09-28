// A game invite, pushed to the invitee's phone the moment it is sent.
//
// Before APNs the invite reached a phone only while its app was open and
// polling (`GET /api/native/games`, every five seconds), so asking somebody
// whose phone was in their pocket asked nobody. The poll stays — it is how an
// open app shows the invite in the lobby, and the fallback for a phone with no
// push token — but an invite a push reached is flagged `pushed` in the poll's
// answer, and the app raises no second banner for it.
//
// Time-sensitive: an invite holds the lobby for two minutes, so a notification
// that waits out a Focus is an invite nobody can answer.

import type { Difficulty } from './tap-duel';
import type { GameId } from './catalogue';
import { gamePlayers } from './players.server';
import { markInvitesPushed, unpushedInvites } from './rooms.server';
import { pushToEmails } from '$lib/server/push-devices';
import type { PushMessage } from '$lib/server/apns';

/** The app's names (`GameKind.title` in SR-AppleApp). */
const TITLES: Record<GameId, string> = {
  'tap-duel': 'Tap Duel',
  'wordle-race': 'Wordle Race',
  'quiz-night': 'Quiz Night',
  'anagram-blitz': 'Anagram Blitz',
  'maths-sprint': 'Quick Maths Sprint',
  'sequence-memory': 'Sequence Memory',
};

const LEVELS: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** "Sam", "Sam and Robin", "John, Sam and Robin". PURE. */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The banner, worded as the app words its own (`GameInvite.notificationTitle`
 * and `notificationBody`), so an invite reads the same however it arrived. PURE.
 */
export function inviteMessage(invite: {
  roomId: string;
  game: GameId;
  difficulty: Difficulty;
  about: string | null;
  hostName: string;
  players: readonly string[];
  expiresAt: number | null;
}, now = Date.now()): PushMessage {
  const base = `${invite.hostName} invited you to ${TITLES[invite.game] ?? invite.game}`;
  const others = invite.players.filter((p) => p !== invite.hostName);
  const who = others.length ? `with ${nameList([invite.hostName, ...others])}` : `with ${invite.hostName}`;
  const ttl = invite.expiresAt ? Math.max(0, Math.floor((invite.expiresAt - now) / 1000)) : 120;
  return {
    title: invite.about ? `${base} — ${invite.about}` : base,
    body: `${LEVELS[invite.difficulty] ?? invite.difficulty}, ${who}. Tap to join.`,
    category: 'game',
    threadId: 'game',
    level: 'time-sensitive',
    relevance: 1,
    // The app's local banner uses the same id, so a push and a poll for one
    // room can never stack two notifications.
    collapseId: `game-${invite.roomId}`,
    userInfo: { roomId: invite.roomId, game: invite.game, category: 'game' },
    // An invite outlived by its lobby is noise: Apple stops trying when it closes.
    ttlSeconds: Math.max(ttl, 1),
  };
}

/**
 * Push every invitee in this room not pushed yet. Fire-and-forget from the
 * route: the room is already made, and an invite whose push failed is still
 * collected by the invitee's poll. Never throws.
 */
export async function pushInvites(roomId: string, push = pushToEmails): Promise<number> {
  try {
    const pending = unpushedInvites(roomId);
    if (!pending?.invitees.length) return 0;
    const roster = new Map((await gamePlayers()).map((p) => [p.id, p.email]));
    const byEmail = new Map<string, string>();
    for (const id of pending.invitees) {
      const email = roster.get(id);
      if (email) byEmail.set(email, id);
    }
    if (!byEmail.size) return 0;
    const outcome = await push([...byEmail.keys()], inviteMessage(pending));
    const reached = [...outcome.reached].map((e) => byEmail.get(e)).filter((id): id is string => !!id);
    markInvitesPushed(roomId, reached);
    return reached.length;
  } catch (error) {
    console.error(`[games] ${roomId}: invite push failed`, (error as Error).message);
    return 0;
  }
}
