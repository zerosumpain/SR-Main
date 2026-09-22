import { identifyDevice } from './native-auth';
import { isOwnerEmail } from './native-handler';

/**
 * Does this request carry a live, owner-held device credential?
 *
 * The one question `hooks.server.ts` needs about a paired iPhone, in its own
 * module so the hook does not import the handler wrapper — `native-handler`
 * pulls in `@sveltejs/kit`'s `json` and the whole RequestEvent type surface,
 * and the hook is on every request's path.
 *
 * Boolean, not an identity: the three orchestrator paths this admits are shared
 * with the browser and resolve their own scope from the request body. Returning
 * an identity here would invite a handler to trust an upstream claim about who
 * is calling, which is the shape of the problem `invoke-auth` documents at
 * length for the SR-JKAI lane.
 */
export async function hasNativeDevice(request: Request): Promise<boolean> {
  const header = request.headers.get('authorization') ?? '';
  // Cheap reject before touching the database. Every browser request to these
  // paths lands here, and none of them carries a bearer token.
  if (!header.startsWith('Bearer ')) return false;

  const identity = await identifyDevice(request);
  if (!identity) return false;
  return isOwnerEmail(identity.ownerEmail);
}
