// "Is this request the site owner?" for routes that live under a PUBLIC hook
// prefix and gate themselves in their own load (e.g. /decks). Mirrors the
// hook's two paths exactly: a signed-in owner session, OR the dev-only LAN
// bypass where no session can
// exist because Google refuses private-network redirect URIs.

import { isOwnerEmail } from './access';
// Was a private copy of the same range list the hook carried, which is how it
// inherited the same bug: neither spelled `::ffff:127.0.0.1`, the form a
// dual-stack listener actually reports. "Mirrors the hook exactly" is only
// true while both mirror ONE definition.
import { clientAddressOf, isDevBypassAddress } from './client-address';
import { env } from '$env/dynamic/private';

export interface OwnerCheckEvent {
  locals: App.Locals;
  getClientAddress?: () => string;
}

export async function isOwnerRequest(event: OwnerCheckEvent): Promise<boolean> {
  try {
    const session = await event.locals.auth();
    if (isOwnerEmail(session?.user?.email)) return true;
  } catch {
    /* fall through to bypass check */
  }
  // Same admission rule as the hook's dev bypass: this machine plus
  // AUTH_BYPASS_ALLOW, never "any private address".
  if (import.meta.env.DEV && isDevBypassAddress(clientAddressOf(event), env.AUTH_BYPASS_ALLOW)) {
    return true;
  }
  return false;
}
