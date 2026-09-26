import type { Permission } from '$lib/access/catalogue';
import { identifyDevice, type NativeIdentity } from './native-auth';
// From `./access`, not `./native-handler` (the same rule, spelled once more
// there): the handler wrapper imports THIS module, and the other way round
// would be a cycle.
import { isOwnerEmail } from './access';
import { loadMember } from './grants';

/**
 * Does this request carry a live, owner-held device credential?
 *
 * The one question `hooks.server.ts` needs about a paired iPhone, in its own
 * module so the hook does not import the handler wrapper — `native-handler`
 * pulls in `@sveltejs/kit`'s `json` and the whole RequestEvent type surface,
 * and the hook is on every request's path.
 *
 * Returns the identity so the hook can key a RATE-LIMIT BUCKET on the device.
 * That is the only use, and it never leaves the hook: nothing is forwarded to
 * the application, no header is set from it, and the handlers behind these paths
 * still resolve their own scope from the request body exactly as they do for a
 * browser. Passing an identity DOWNSTREAM is the thing `invoke-auth` documents
 * at length as unsafe for the SR-JKAI lane, and that is still not done here.
 *
 * OWNER-ONLY, and it stays that way: the orchestrator lane in the hook treats a
 * non-null answer here as "resolve sessionless", which the area seam reads as
 * the owner. A member's phone is `memberDevice`'s question, not a wider answer
 * to this one.
 */
export async function nativeDevice(request: Request): Promise<NativeIdentity | null> {
  const identity = await pairedDevice(request);
  if (!identity) return null;
  return isOwnerEmail(identity.ownerEmail) ? identity : null;
}

/**
 * Any live device credential, whoever holds it — for keying a rate-limit
 * bucket and NOTHING else.
 *
 * The `/api/native` tree keyed its bucket on `nativeDevice`, which is null for
 * a member's phone, so once members could pair, their writes would have gone
 * uncapped. What a device may DO is the handler wrapper's decision, never this.
 */
export async function pairedDevice(request: Request): Promise<NativeIdentity | null> {
  const header = request.headers.get('authorization') ?? '';
  // Cheap reject before touching the database. Every browser request to these
  // paths lands here, and none of them carries a bearer token.
  if (!header.startsWith('Bearer ')) return null;
  return identifyDevice(request);
}

export interface DeviceMember {
  identity: NativeIdentity;
  principalId: string;
  grants: ReadonlySet<Permission>;
}

/**
 * A live device credential held by a MEMBER — a non-owner whose email holds at
 * least one permission right now — or null.
 *
 * Null for the owner (that is `nativeDevice`), for a guest, for an unknown or
 * expired token, and for a lookup that fails: every doubt reads as "not a
 * member device", and the request then carries no identity at all. Grants are
 * read fresh on every call, never from the row, so demoting someone closes
 * their phone on its next request.
 */
export async function memberDevice(request: Request): Promise<DeviceMember | null> {
  const identity = await pairedDevice(request);
  if (!identity || isOwnerEmail(identity.ownerEmail)) return null;
  try {
    const member = await loadMember(identity.ownerEmail);
    return member ? { identity, principalId: member.principalId, grants: member.grants } : null;
  } catch (err) {
    console.error('[native] member lookup failed:', err);
    return null;
  }
}

/**
 * Make the rest of this request see the member who holds the device, exactly
 * as it would see them signed in on the web.
 *
 * Two answers are set, because the site asks "who is this" two ways:
 *  - `locals.viewer`, which `viewerOf` caches — the area seam, `chatAccess`,
 *    `newsCapabilities` and the hook's `memberMayReach` all read it;
 *  - `locals.auth()`, a session carrying the member's email — the hook's `/api`
 *    gate refuses a request without one, and `newsOwnerKey` keys a reader's
 *    saved and read stories on it.
 *
 * Without them a member's device would pass as SESSIONLESS, and on every route
 * that reads the seam sessionless is the owner (`areaAccess` treats anonymous
 * as an owner-grade lane). Both are overwritten rather than filled in where
 * missing, so a stray cookie on the same request can never widen it either.
 */
export function actAsDeviceMember(locals: App.Locals, member: DeviceMember): void {
  const email = member.identity.ownerEmail.trim().toLowerCase();
  locals.viewer = Promise.resolve({
    kind: 'member',
    principalId: member.principalId,
    email,
    grants: member.grants,
  });
  const session = { user: { email }, expires: member.identity.expiresAt.toISOString() };
  locals.auth = async () => session;
}
