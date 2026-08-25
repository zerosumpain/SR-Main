import { describe, it, expect } from 'vitest';
import { isLoopbackAddress, isPrivateAddress } from './client-address';
import { unwrapMappedIPv4 } from './ssrf-guard';

/**
 * The whole point of these two is the spelling `getClientAddress()` actually
 * uses. Every case below that starts `::ffff:` is one a hand-written check
 * against `'127.0.0.1'` gets wrong — and gets wrong CLOSED, which reads as
 * "auth is broken" rather than "the address is written differently".
 */

describe('unwrapMappedIPv4', () => {
  it('unwraps both spellings of a mapped address', () => {
    // Dotted: what a socket reports. Hextets: what `new URL()` normalises to.
    expect(unwrapMappedIPv4('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(unwrapMappedIPv4('::ffff:7f00:1')).toBe('127.0.0.1');
    expect(unwrapMappedIPv4('::FFFF:192.168.0.57')).toBe('192.168.0.57');
  });

  it('leaves everything else alone', () => {
    expect(unwrapMappedIPv4('127.0.0.1')).toBe('127.0.0.1');
    expect(unwrapMappedIPv4('::1')).toBe('::1');
    expect(unwrapMappedIPv4('fe80::1%eth0')).toBe('fe80::1%eth0');
    expect(unwrapMappedIPv4('')).toBe('');
  });
});

describe('isLoopbackAddress', () => {
  it('accepts the mapped form a dual-stack listener reports', () => {
    // The exact value observed from `vite dev --host` on homeserv, which is why
    // every /api call from the box answered 401.
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::ffff:7f00:1')).toBe(true);
  });

  it('accepts the plain forms it always did', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
  });

  it('accepts the rest of 127/8, not just .0.0.1', () => {
    expect(isLoopbackAddress('127.0.1.1')).toBe(true);
    expect(isLoopbackAddress('127.255.255.254')).toBe(true);
  });

  it('refuses anything that is not this machine', () => {
    // A LAN peer is not loopback — these endpoints are for something running
    // ON the box, and "somewhere on the network" is a different permission.
    expect(isLoopbackAddress('192.168.0.57')).toBe(false);
    expect(isLoopbackAddress('100.72.165.45')).toBe(false);
    expect(isLoopbackAddress('8.8.8.8')).toBe(false);
    expect(isLoopbackAddress('::ffff:8.8.8.8')).toBe(false);
    expect(isLoopbackAddress('')).toBe(false);
    expect(isLoopbackAddress('not-an-address')).toBe(false);
  });
});

describe('isPrivateAddress', () => {
  it('accepts the mapped form of every private range', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:192.168.0.57')).toBe(true);
    expect(isPrivateAddress('::ffff:10.1.2.3')).toBe(true);
    // Tailscale CGNAT — homeserv's own 100.72.x address.
    expect(isPrivateAddress('::ffff:100.72.165.45')).toBe(true);
  });

  it('keeps accepting everything the hand-written check did', () => {
    for (const addr of [
      '127.0.0.1',
      '::1',
      '10.0.0.1',
      '192.168.0.57',
      '172.16.0.1',
      '172.31.255.255',
      '100.64.0.1',
      '100.127.255.255',
    ]) {
      expect(isPrivateAddress(addr), addr).toBe(true);
    }
  });

  it('admits nothing that is routable from the public internet', () => {
    // The fix is a spelling correction, not a widening: a public address in
    // the mapped form normalises to the same public address and is still out.
    for (const addr of [
      '8.8.8.8',
      '::ffff:8.8.8.8',
      '172.15.0.1', // just below the 172.16/12 block
      '172.32.0.1', // just above it
      '100.63.255.255', // just below CGNAT
      '100.128.0.1', // just above it
      '2a02:c7c:6edf:9500::1', // homeserv's PUBLIC v6 address
      '',
      'not-an-address',
    ]) {
      expect(isPrivateAddress(addr), addr).toBe(false);
    }
  });

  it('treats a LAN peer as private but not as loopback', () => {
    expect(isPrivateAddress('192.168.0.57')).toBe(true);
    expect(isLoopbackAddress('192.168.0.57')).toBe(false);
  });
});
