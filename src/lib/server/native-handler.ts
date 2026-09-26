import { isHttpError, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { satisfies, type AreaId } from '$lib/access/catalogue';
import { identifyDevice, touchDevice, type NativeIdentity } from './native-auth';
import { actAsDeviceMember } from './native-gate';
import { loadMember } from './grants';

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

export type NativeRole = 'owner' | 'member';

export type NativeAccessHandler<E extends RequestEvent, T> = (
  event: E,
  identity: NativeIdentity,
  role: NativeRole,
) => Promise<T> | T;

/**
 * `withDevice`, opened to a MEMBER's phone for one area — the wrapper a route
 * uses once it scopes itself exactly like its web twin, and not before.
 *
 * `withDevice` stays owner-only on purpose. Every handler written before
 * members could pair assumes the owner (the owner's threads, the owner's graph,
 * the owner's defaults), so a route reaches members only by being converted to
 * this, one at a time, and a route nobody converted keeps refusing them. That
 * is the whole design: new reach is opt-in per file, never inherited.
 *
 * For the owner nothing changes: no locals are touched, the request stays
 * sessionless, and the area seam reads that as the owner exactly as it did.
 *
 * For anyone else the email on the credential must be a member NOW
 * (`loadMember`, read fresh on every request, so a demotion closes the phone on
 * its next call) holding `<area>:self`. The request is then made to look like
 * that member signed in on the web (`actAsDeviceMember`) so every web helper —
 * `chatAccess`, `requireConversation`, `newsCapabilities`, `newsOwnerKey` —
 * answers for them and not for the sessionless owner.
 *
 * `area: 'any'` is for `/api/native/me` alone: the call the phone makes to ask
 * what it may show, which must answer any member whatever they hold.
 *
 * A refusal thrown by a web helper (404 for a thread they cannot see, 429 for a
 * daily cap) comes back as `{ error }` with its status. Those sentences were
 * written for a person — "That is 30 files today — the limit." — and flattening
 * them into "Something went wrong" would leave the phone retrying a cap.
 */
export function withNativeAccess<E extends RequestEvent, T>(
  area: AreaId | 'any',
  handler: NativeAccessHandler<E, T>,
) {
  return async (event: E): Promise<Response> => {
    const identity = await identifyDevice(event.request);
    if (!identity) {
      return json({ error: 'Pair this iPhone again.' }, { status: 401 });
    }

    let role: NativeRole = 'owner';
    if (!isOwnerEmail(identity.ownerEmail)) {
      // Fail closed: a lookup that cannot reach the database refuses the
      // request rather than guessing who this is.
      const member = await loadMember(identity.ownerEmail).catch((err) => {
        console.error('[native] member lookup failed:', err);
        return null;
      });
      if (!member) {
        return json({ error: 'This account can no longer use the app.' }, { status: 403 });
      }
      if (area !== 'any' && !satisfies(member.grants, `${area}:self`)) {
        return json({ error: 'Your access does not include that.' }, { status: 403 });
      }
      actAsDeviceMember(event.locals, { identity, principalId: member.principalId, grants: member.grants });
      role = 'member';
    }

    void touchDevice(identity.id).catch(() => {});

    try {
      const result = await handler(event, identity, role);
      if (result instanceof Response) return result;
      return json(result as Record<string, unknown>);
    } catch (error) {
      if (isHttpError(error)) return json({ error: error.body.message }, { status: error.status });
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
