import { identifyDevice, type NativeIdentity } from './native-auth';
import { isOwnerEmail } from './native-handler';

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
 */
export async function nativeDevice(request: Request): Promise<NativeIdentity | null> {
  const header = request.headers.get('authorization') ?? '';
  // Cheap reject before touching the database. Every browser request to these
  // paths lands here, and none of them carries a bearer token.
  if (!header.startsWith('Bearer ')) return null;

  const identity = await identifyDevice(request);
  if (!identity) return null;
  return isOwnerEmail(identity.ownerEmail) ? identity : null;
}
