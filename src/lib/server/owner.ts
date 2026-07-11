// "Is this request the site owner?" for routes that live under a PUBLIC hook
// prefix and gate themselves in their own load (e.g. /decks). Mirrors the
// hook's two paths exactly: a signed-in owner session, OR the LAN/dev bypass
// (dev build or AUTH_BYPASS=1, from a private address) where no session can
// exist because Google refuses private-network redirect URIs.

import { env } from '$env/dynamic/private';
import { isOwnerEmail } from './access';

export interface OwnerCheckEvent {
  locals: App.Locals;
  getClientAddress?: () => string;
}

function isPrivateAddress(addr: string): boolean {
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr.startsWith('10.') ||
    addr.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(addr) ||
    /^100\.(6[4-9]|[789]\d|1[01]\d|12[0-7])\./.test(addr)
  );
}

export async function isOwnerRequest(event: OwnerCheckEvent): Promise<boolean> {
  try {
    const session = await event.locals.auth();
    if (isOwnerEmail(session?.user?.email)) return true;
  } catch {
    /* fall through to bypass check */
  }
  if (import.meta.env.DEV || env.AUTH_BYPASS === '1') {
    let addr = '';
    try {
      addr = event.getClientAddress?.() ?? '';
    } catch {
      addr = '';
    }
    if (isPrivateAddress(addr)) return true;
  }
  return false;
}
