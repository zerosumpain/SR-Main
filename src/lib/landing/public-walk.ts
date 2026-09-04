export const PUBLIC_WALK_EXPIRE_MS = 4 * 60 * 60 * 1000;

export interface PublicWalkState {
  active: boolean;
}

/** Reduce the private GPS broadcast to the single fact safe for the homepage. */
export function publicWalkState(raw: unknown, now = Date.now()): PublicWalkState {
  if (!raw || typeof raw !== 'object') return { active: false };
  const state = raw as { receivedAt?: unknown; status?: unknown };
  if (typeof state.receivedAt !== 'number' || !Number.isFinite(state.receivedAt)) {
    return { active: false };
  }
  return {
    active: now - state.receivedAt <= PUBLIC_WALK_EXPIRE_MS && state.status !== 'finished',
  };
}
