// $lib/server/client-address.ts
//
// Classifying the address a request CAME FROM, as opposed to one we are about
// to fetch (that is $lib/server/ssrf-guard). Both sides need the same
// IPv4-mapped normalisation, which is why `unwrapMappedIPv4` lives there and
// is imported here rather than written twice.
//
// The trap this module exists to close: `event.getClientAddress()` does not
// return `127.0.0.1` for a loopback client. On a dual-stack listener — which
// is what `vite dev --host` opens — Node reports `req.socket.remoteAddress` as
// `::ffff:127.0.0.1`, the IPv4-mapped IPv6 form. Hand-written checks that
// compare against the dotted literal therefore fail for every client, and they
// fail CLOSED: the homeserv dev server's LAN auth bypass stopped matching, so
// every `/api/` call from the box itself answered 401 while the same code
// served fine from the systemd build (which listens on IPv4 and sees a bare
// quad). Cost: an afternoon, twice, because the symptom reads as "auth is
// broken" rather than "the address is spelled differently".
//
// Failing closed is the reason this is a correctness fix and not a widening.
// Both predicates already accepted `127.0.0.1`; teaching them the mapped
// spelling of the SAME address admits nothing new. A public address wearing
// the mapped form (`::ffff:8.8.8.8`) normalises to `8.8.8.8` and is still
// refused by both.

import { BlockList, isIP } from 'node:net';
import { isBlockedIP, unwrapMappedIPv4 } from './ssrf-guard';

/**
 * True when the request came from this machine.
 *
 * Stricter than `isPrivateAddress` on purpose — the callers are endpoints
 * driven by something running ON the box (the systemd watchdog's curl, a
 * maintenance run carrying a shared secret), where "somewhere on the LAN" is
 * not the same permission.
 */
export function isLoopbackAddress(addr: string): boolean {
  if (!addr) return false;
  const ip = unwrapMappedIPv4(addr);
  if (isIP(ip) === 4) return ip.split('.')[0] === '127'; // 127/8, not just .0.0.1
  return ip.toLowerCase().split('%')[0] === '::1';
}

/**
 * True when the request came from a network that is not the public internet —
 * loopback, RFC1918, CGNAT (Tailscale's 100.64/10), link-local, IPv6 ULA.
 *
 * Deliberately the same predicate the SSRF guard uses to refuse an outbound
 * target: "not routable from the public internet" is one property, and having
 * two lists of ranges is how one of them ends up a release behind the other.
 * The names differ because the QUESTION differs, not the answer.
 *
 * No unwrap call here: `isBlockedIP` does its own, and has since the SSRF
 * mapped-address fix. That is precisely why this delegates rather than
 * re-implementing the ranges — the inbound side inherits every future
 * correction to them for free.
 */
export function isPrivateAddress(addr: string): boolean {
  return isBlockedIP(addr);
}

/**
 * True when the request was made ON this machine, not merely delivered by it.
 *
 * In production cloudflared terminates every internet request and re-issues
 * it from loopback, so `isLoopbackAddress` alone says yes to the whole world.
 * Cloudflare always stamps `cf-connecting-ip` on what it forwards (and
 * overwrites any value a client sent), while the box's own callers — the
 * systemd watchdog's curl, a maintenance run — never set it. So "local" is
 * loopback with no edge header; a tunnelled request carrying the header is an
 * internet request whatever the socket says.
 */
export function isLocalRequest(request: Request, addr: string): boolean {
  return isLoopbackAddress(addr) && !request.headers.has('cf-connecting-ip');
}

/** `getClientAddress()` without the throw it raises in some adapters/tests. */
export function clientAddressOf(event: { getClientAddress?: () => string }): string {
  try {
    return event.getClientAddress?.() ?? '';
  } catch {
    return '';
  }
}

/**
 * Who the DEVELOPMENT sign-in bypass admits: this machine, plus the addresses
 * named in `AUTH_BYPASS_ALLOW` (comma-separated IPs or CIDRs — the owner's
 * own devices). It used to be every private address, which made any other
 * server on the LAN or tailnet the owner of a dev server it could reach.
 * Malformed entries are ignored rather than widening anything.
 */
export function isDevBypassAddress(addr: string, allow: string | undefined): boolean {
  if (isLoopbackAddress(addr)) return true;
  if (!addr || !allow) return false;
  const ip = unwrapMappedIPv4(addr).split('%')[0];
  const family = isIP(ip);
  if (!family) return false;
  const list = new BlockList();
  for (const raw of allow.split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    const [base, bits] = entry.split('/');
    const baseFamily = isIP(base);
    if (!baseFamily) continue;
    const type = baseFamily === 4 ? 'ipv4' : 'ipv6';
    if (bits === undefined) {
      list.addAddress(base, type);
      continue;
    }
    const prefix = Number(bits);
    if (!/^\d+$/.test(bits) || prefix > (baseFamily === 4 ? 32 : 128)) continue;
    list.addSubnet(base, prefix, type);
  }
  return list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}
