import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENDPOINTS, byHost, publicUnauthenticated, unmonitored } from './endpoints';
import { HOOK_BYPASSES, HOOK_EXACT_BYPASSES, HOOK_NON_BYPASSES, BYPASS_GUARDS } from '$lib/server/gate-bypasses';
import { PUBLIC_API_PATHS } from '$lib/server/public-api-paths';

describe('estate catalogue', () => {
  it('has unique ids', () => {
    const ids = ENDPOINTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('puts every endpoint in exactly one host group', () => {
    const grouped = byHost().flatMap(([, items]) => items);
    expect(grouped.length).toBe(ENDPOINTS.length);
  });

  it('gives every endpoint an address you can act on', () => {
    for (const e of ENDPOINTS) {
      expect(e.url ?? e.address, `${e.id} has neither url nor address`).toBeTruthy();
      expect(e.configuredIn, `${e.id} has no configuredIn`).toBeTruthy();
    }
  });

  it('never hard-codes porkserv’s DHCP LAN address', () => {
    // The lease moves; the tailnet address does not. A 192.168.0.77 in here
    // would silently point at whatever picks that address up next.
    const serialised = JSON.stringify(ENDPOINTS);
    expect(serialised).not.toContain('192.168.0.77');
  });

  it('flags a public+unauthenticated endpoint, and only an unexcused one', () => {
    // Every current public entry carries a stated reason, so the finding is empty.
    expect(publicUnauthenticated()).toEqual([]);

    const withHole = [
      ...ENDPOINTS,
      {
        id: 'hole',
        label: 'Wide open',
        host: 'vps' as const,
        exposure: 'public' as const,
        auth: 'none' as const,
        note: 'test',
        configuredIn: 'test',
      },
    ];
    expect(publicUnauthenticated(withHole).map((e) => e.id)).toEqual(['hole']);
  });

  it('counts anything the uptime monitor does not watch as unmonitored', () => {
    const ids = unmonitored().map((e) => e.id);
    // The monitor probes exactly two URLs — the site root and the vitals API.
    expect(ids).not.toContain('site');
    expect(ids).not.toContain('site-vitals');
    expect(ids).toContain('pork-adguard');
    expect(unmonitored().length).toBe(ENDPOINTS.length - 2);
  });

  it('probes only ids the probe module actually returns', async () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/estate/probe.server.ts'), 'utf8');
    const probeIds = ENDPOINTS.map((e) => e.probeId).filter(Boolean) as string[];
    for (const id of probeIds) {
      // A probeId with no matching key renders forever as "unknown", which
      // reads as "not probed" rather than "broken" — a silent blind spot.
      expect(src, `probe.server.ts has no key for probeId "${id}"`).toContain(`'${id}'`);
    }
  });
});

describe('gate bypass catalogue', () => {
  it('keeps the four categories disjoint', () => {
    const lists: Array<[string, string[]]> = [
      ['bypass', HOOK_BYPASSES],
      ['exact', HOOK_EXACT_BYPASSES],
      ['non', HOOK_NON_BYPASSES],
    ];
    for (const [aName, a] of lists) {
      for (const [bName, b] of lists) {
        if (aName >= bName) continue;
        expect(a.filter((x) => b.includes(x)), `${aName} vs ${bName}`).toEqual([]);
      }
    }
  });

  it('never lists a bare /api as a bypass', () => {
    // /api is the rule that ENFORCES auth. If it ever lands in a bypass list,
    // every API route on the site reads as anonymous.
    expect(HOOK_BYPASSES).not.toContain('/api');
    expect(HOOK_EXACT_BYPASSES).not.toContain('/api');
  });

  it('describes a guard for every bypassed prefix', () => {
    for (const p of [...HOOK_BYPASSES, ...HOOK_EXACT_BYPASSES]) {
      expect(BYPASS_GUARDS[p], `no guard label for ${p}`).toBeTruthy();
    }
  });

  it('stays in step with the path literals in hooks.server.ts', () => {
    // The same assertion the CI lockfile makes, kept here so a local test run
    // catches an unclassified bypass before CI does.
    const src = readFileSync(join(process.cwd(), 'src/hooks.server.ts'), 'utf8');
    const seen = new Set<string>();
    for (const m of src.matchAll(/pathname(?:\s*===\s*|\.startsWith\()\s*'([^']+)'/g)) {
      seen.add(m[1].replace(/\/$/, ''));
    }
    const known = new Set([
      ...HOOK_BYPASSES,
      ...HOOK_EXACT_BYPASSES,
      ...HOOK_NON_BYPASSES,
      '/tools',
      ...PUBLIC_API_PATHS,
    ]);
    expect([...seen].filter((p) => !known.has(p))).toEqual([]);
  });
});
