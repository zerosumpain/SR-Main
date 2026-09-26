// What the iPhone app may show a person — one set of flags, answered the same
// way whether the phone asks the site (`/api/native/me`) or the site pushes it
// through the pilot (`$lib/home/presence/app-view`).
//
// The flags are a MENU, not a gate. Each is the grant the matching web area
// asks for, so a tab the app shows is a tab whose routes will answer; the
// routes still check for themselves (`withNativeAccess`), and a flag that is
// wrong in the app's favour opens nothing.

import { satisfies, type Permission } from '$lib/access/catalogue';
import { isOwnerEmail } from './access';
import { loadMember } from './grants';

export interface AppAccess {
  owner: boolean;
  /** jkai.chat:self */
  chat: boolean;
  /** news:self */
  news: boolean;
  /** research:self */
  research: boolean;
  /** jkai.notes:self */
  notes: boolean;
  /** jkai.intel:self */
  intel: boolean;
  /** games:self — the Games tab. */
  games: boolean;
  /** Sees the household: the owner, or Family Circle + a household row (`peopleViewerForEmail`). */
  family: boolean;
}

export const NO_APP_ACCESS: Readonly<AppAccess> = Object.freeze({
  owner: false,
  chat: false,
  news: false,
  research: false,
  notes: false,
  intel: false,
  games: false,
  family: false,
});

/** PURE. The owner holds everything; a member what their grants satisfy; anyone else nothing. */
export function appAccessFrom(input: {
  owner: boolean;
  grants: Iterable<Permission> | null;
  family: boolean;
}): AppAccess {
  if (input.owner) {
    return { owner: true, chat: true, news: true, research: true, notes: true, intel: true, games: true, family: true };
  }
  if (!input.grants) return { ...NO_APP_ACCESS, family: input.family };
  const held = [...input.grants];
  return {
    owner: false,
    chat: satisfies(held, 'jkai.chat:self'),
    news: satisfies(held, 'news:self'),
    research: satisfies(held, 'research:self'),
    notes: satisfies(held, 'jkai.notes:self'),
    intel: satisfies(held, 'jkai.intel:self'),
    games: satisfies(held, 'games:self'),
    family: input.family,
  };
}

/**
 * The flags for an email, with the member lookup behind them (null for the
 * owner and for anyone holding nothing). A failed lookup reads as holding
 * nothing: a menu that is briefly too short is the safe direction.
 */
export async function appAccessForEmail(
  email: string,
  family: boolean,
): Promise<{ access: AppAccess; member: { principalId: string; grants: Set<Permission> } | null }> {
  const e = email.trim().toLowerCase();
  if (isOwnerEmail(e)) return { access: appAccessFrom({ owner: true, grants: null, family: true }), member: null };
  const member = await loadMember(e).catch((err) => {
    console.error('[app-access] member lookup failed:', err);
    return null;
  });
  return { access: appAccessFrom({ owner: false, grants: member?.grants ?? null, family }), member };
}
