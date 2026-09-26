// Who can play: everyone with a live site pairing who is the owner or holds
// `games:self`. A person with no paired phone could not open an invite, so they
// are not offered one.
//
// A player's id is a keyed hash of their email, so the phone never carries
// anyone else's address, a guessed address cannot be tested against it, and the
// id stays the same across rooms.

import { createHmac } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { satisfies } from '$lib/access/catalogue';
import { isOwnerEmail } from '$lib/server/access';
import { loadMember } from '$lib/server/grants';
import { listAllSiteDevices } from '$lib/server/site-devices';
import { listMembers } from '$lib/home/presence/members';

export interface GamePlayer {
  id: string;
  email: string;
  name: string;
}

export function playerId(email: string): string {
  const key = env.AUTH_SECRET || 'sr-games';
  return 'p_' + createHmac('sha256', key).update(email.trim().toLowerCase()).digest('hex').slice(0, 12);
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  return local ? local[0].toUpperCase() + local.slice(1) : email;
}

/** Every phone polls every few seconds; the roster changes when someone is granted or pairs. */
const TTL_MS = 60_000;
let cache: { at: number; players: GamePlayer[] } | null = null;

export async function gamePlayers(now = Date.now()): Promise<GamePlayer[]> {
  if (cache && now - cache.at < TTL_MS) return cache.players;

  const emails = new Set<string>();
  for (const d of await listAllSiteDevices()) {
    if (d.revokedAt || d.expiresAt.getTime() <= now) continue;
    emails.add(d.ownerEmail.trim().toLowerCase());
  }

  const names = new Map<string, string>();
  for (const m of await listMembers().catch(() => [])) {
    if (m.email) names.set(m.email.trim().toLowerCase(), m.displayName);
  }

  const players: GamePlayer[] = [];
  for (const email of emails) {
    if (!isOwnerEmail(email)) {
      const member = await loadMember(email).catch(() => null);
      if (!member || !satisfies(member.grants, 'games:self')) continue;
    }
    players.push({ id: playerId(email), email, name: names.get(email) ?? nameFromEmail(email) });
  }
  players.sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: now, players };
  return players;
}

/** The caller as a player, whether or not the roster has caught up with them yet. */
export async function playerFor(email: string): Promise<GamePlayer> {
  const e = email.trim().toLowerCase();
  const known = (await gamePlayers()).find((p) => p.email === e);
  if (known) return known;
  const member = await listMembers()
    .then((all) => all.find((m) => m.email?.trim().toLowerCase() === e))
    .catch(() => undefined);
  return { id: playerId(e), email: e, name: member?.displayName ?? nameFromEmail(e) };
}
