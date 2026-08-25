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

import { isIP } from 'node:net';
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
