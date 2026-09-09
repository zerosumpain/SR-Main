import { error, json, type RequestEvent } from '@sveltejs/kit';
import { getOwnerEmails, isOwnerEmail } from '$lib/server/access';
import { isOwnerRequest } from '$lib/server/owner';
import { rateLimit } from '$lib/server/rate-limit';
import { PolicyError } from '../validation';
export async function requirePolicyOwner(event: Pick<RequestEvent, 'locals' | 'getClientAddress' | 'setHeaders'>): Promise<string> {
  event.setHeaders({ 'cache-control': 'private, no-store' });
  const session = await event.locals.auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (email) { if (!isOwnerEmail(email)) error(403, 'Forbidden'); return email; }
  if (await isOwnerRequest(event)) {
    const owner = getOwnerEmails()[0];
    if (owner) return owner;
  }
  error(401, 'Sign in to access policy analyses.');
}
export function checkMutation(event: Pick<RequestEvent, 'request' | 'url'>, owner: string) {
  const origin = event.request.headers.get('origin');
  if (origin && origin !== event.url.origin) error(403, 'Cross-origin requests are not allowed.');
  if (!rateLimit(`policy:${owner}`, { capacity: 8, refillPerSecond: 1 / 30 }).allowed) error(429, 'Too many requests. Please wait before trying again.');
}
export function failure(err: unknown) {
  if (err instanceof PolicyError) return json({ error: err.message }, { status: err.code === 'missing' ? 404 : err.code === 'capacity' ? 429 : 400 });
  return json({ error: 'The policy service is unavailable. Please try again.' }, { status: 503 });
}
