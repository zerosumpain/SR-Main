import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { identifyDevice, touchDevice, type NativeIdentity } from './native-auth';

/**
 * The gate every `/api/native/*` handler passes through.
 *
 * `hooks.server.ts` lets the whole subtree past the session check, which is only
 * safe because of this function: a route that does not call it has no identity
 * and therefore nothing to answer with. That is the intended failure — a
 * forgotten gate reads as an empty handler, not as an open one.
 *
 * It re-derives the owner allow-list from the email on the credential rather
 * than trusting that pairing implied it. A token minted before an address left
 * `AUTH_ALLOWED_EMAILS` must stop working when the address does, and the row
 * cannot know that happened.
 */

/** Mirrors `getAllowedEmails()` in hooks.server.ts and `/api/auth/me`. */
function allowedEmails(): string[] {
  return (env.AUTH_ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwnerEmail(email: string): boolean {
  const value = email.trim().toLowerCase();
  return !!value && allowedEmails().includes(value);
}

export type NativeHandler<E extends RequestEvent, T> = (
  event: E,
  identity: NativeIdentity,
) => Promise<T> | T;

/**
 * Resolve the device, refuse if it is not an owner's, then run the handler.
 *
 * A thrown error becomes a 500 with a fixed sentence. Handlers under here are
 * read paths over libraries that already have their own error vocabulary, and
 * forwarding `error.message` to a phone would put internal detail on a lock
 * screen for no operational gain.
 */
// Generic over the EVENT, not just the result. Assigned to a route's
// `RequestHandler` from `./$types`, that is what lets TypeScript infer the
// route's own params — typed as a bare `RequestEvent` every `params.id` arrives
// as `string | undefined` and each handler has to re-narrow something SvelteKit
// already guarantees.
export function withDevice<E extends RequestEvent, T>(handler: NativeHandler<E, T>) {
  return async (event: E): Promise<Response> => {
    const identity = await identifyDevice(event.request);
    if (!identity) {
      return json({ error: 'Pair this iPhone again.' }, { status: 401 });
    }
    if (!isOwnerEmail(identity.ownerEmail)) {
      return json({ error: 'This account can no longer use the app.' }, { status: 403 });
    }

    // Telemetry for the device list. Deliberately not awaited into the response
    // path: a failed stamp must not turn a good read into a 500.
    void touchDevice(identity.id).catch(() => {});

    try {
      const result = await handler(event, identity);
      if (result instanceof Response) return result;
      return json(result as Record<string, unknown>);
    } catch (error) {
      console.error(`[native] ${event.url.pathname} failed`, error);
      return json({ error: 'Something went wrong. Try again.' }, { status: 500 });
    }
  };
}

/**
 * Clamp a caller-supplied count into a range the phone can actually render.
 *
 * The null check is separate and comes FIRST because `Number(null)` is 0, not
 * NaN — folding it into the finite test clamped an absent `?limit=` to the
 * floor, so every request that simply did not ask got a single row back.
 */
export function clampLimit(raw: string | null, fallback: number, max: number): number {
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}
