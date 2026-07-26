import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lookup } from 'node:dns/promises';
import { assertPublicUrl, isBlockedIP } from './ssrf-guard';

// DNS is mocked so hostname tests are deterministic and offline. Literal-IP
// tests never hit the mock (assertPublicUrl short-circuits on isIP()).
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
const mockLookup = vi.mocked(lookup);

beforeEach(() => {
  mockLookup.mockReset();
});

describe('isBlockedIP', () => {
  const blocked = [
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1', // CGNAT low
    '100.127.255.255', // CGNAT high
    '224.0.0.1', // multicast
    '::1',
    '::',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    'febf::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback (dotted form)
    // IPv4-mapped in HEXTET form — the shape `new URL()` normalises to, and so
    // the shape every caller actually passes (they read `url.hostname`).
    // Unwrapping only the dotted form meant `http://[::ffff:127.0.0.1]/` reached
    // loopback through every SSRF-guarded path on the site: the slice left
    // '7f00:1', isIP() called that "not an IP", and it fell through to allowed.
    '::ffff:7f00:1', // 127.0.0.1
    '::ffff:a00:1', // 10.0.0.1
    '::ffff:c0a8:1', // 192.168.0.1
    '::ffff:a9fe:a9fe', // 169.254.169.254 (cloud metadata)
    '::ffff:6440:1', // 100.64.0.1 CGNAT / Tailscale range
  ];
  for (const ip of blocked) {
    it(`blocks ${ip}`, () => expect(isBlockedIP(ip)).toBe(true));
  }

  it('blocks the mapped-loopback literal as a URL hostname (the real attack shape)', () => {
    // Callers do `isBlockedIP(new URL(u).hostname.replace(/^\[|\]$/g, ''))`.
    const inner = new URL('http://[::ffff:127.0.0.1]/').hostname.replace(/^\[|\]$/g, '');
    expect(inner).toBe('::ffff:7f00:1'); // normalised by WHATWG URL
    expect(isBlockedIP(inner)).toBe(true);
  });

  it('still allows a genuinely public IPv4-mapped address', () => {
    expect(isBlockedIP('::ffff:808:808')).toBe(false); // 8.8.8.8
  });

  const allowed = ['8.8.8.8', '93.184.216.34', '1.1.1.1', '100.63.255.255', '100.128.0.1', '2606:4700::1111'];
  for (const ip of allowed) {
    it(`allows ${ip}`, () => expect(isBlockedIP(ip)).toBe(false));
  }
});

describe('assertPublicUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicUrl('ftp://example.com/x')).rejects.toThrow(/ssrf_blocked/);
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/ssrf_blocked/);
  });

  it('rejects a malformed URL', async () => {
    await expect(assertPublicUrl('not a url')).rejects.toThrow(/ssrf_blocked/);
  });

  it('rejects literal private/loopback/link-local/CGNAT IPs without DNS', async () => {
    for (const u of [
      'http://10.0.0.1/x',
      'http://127.0.0.1:8080/y',
      'http://192.168.1.1/',
      'http://172.16.5.5/',
      'http://169.254.169.254/latest/meta-data', // cloud metadata
      'http://100.64.1.1/',
      'http://[::1]/',
    ]) {
      await expect(assertPublicUrl(u)).rejects.toThrow(/ssrf_blocked/);
    }
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('rejects localhost and private namespaces', async () => {
    await expect(assertPublicUrl('http://localhost/x')).rejects.toThrow(/ssrf_blocked/);
    await expect(assertPublicUrl('http://foo.internal/x')).rejects.toThrow(/ssrf_blocked/);
    await expect(assertPublicUrl('http://box.tail668b8c.ts.net/x')).rejects.toThrow(/ssrf_blocked/);
  });

  it('blocks a public hostname that DNS-resolves to a private IP', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(assertPublicUrl('http://rebind.example.com/x')).rejects.toThrow(
      /ssrf_blocked: rebind\.example\.com resolves to private IP 127\.0\.0\.1/,
    );
  });

  it('allows a public hostname resolving to a public IP', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const u = await assertPublicUrl('https://example.com/api/v1');
    expect(u).toBeInstanceOf(URL);
    expect(u.hostname).toBe('example.com');
  });

  it('rejects when DNS resolution fails', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertPublicUrl('https://nope.example.com/')).rejects.toThrow(/ssrf_blocked: DNS lookup failed/);
  });

  it('allowInternal bypasses the private-range checks (still enforces http/https)', async () => {
    const u = await assertPublicUrl('http://127.0.0.1:5173/health', { allowInternal: true });
    expect(u.hostname).toBe('127.0.0.1');
    expect(mockLookup).not.toHaveBeenCalled();
    await expect(assertPublicUrl('ftp://127.0.0.1/', { allowInternal: true })).rejects.toThrow(/ssrf_blocked/);
  });
});
