import { describe, expect, it } from 'vitest';
import {
  agentLabel,
  isAutomated,
  networkLetter,
  networkPrefix,
  readShareVisit,
  visitStats,
  type VisitorRow,
} from './share-visitor';

/**
 * What Main keeps about a share link's visitor: a short browser label, a
 * hashed network and a hashed visitor, never the raw values, and the numbers
 * the Share panel shows from them.
 */

const UA = {
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  edgeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  whatsapp: 'WhatsApp/2.24.21.80 A',
  imessage:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0',
  slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  curl: 'curl/8.5.0',
};

describe('agent labels', () => {
  it('names the browser and the system, and nothing more', () => {
    expect(agentLabel(UA.chromeWin)).toBe('Chrome · Windows');
    expect(agentLabel(UA.edgeWin)).toBe('Edge · Windows');
    expect(agentLabel(UA.safariIphone)).toBe('Safari · iPhone');
    expect(agentLabel(UA.chromeIphone)).toBe('Chrome · iPhone');
    expect(agentLabel(UA.firefoxMac)).toBe('Firefox · macOS');
    expect(agentLabel(UA.safariMac)).toBe('Safari · macOS');
    expect(agentLabel(UA.chromeAndroid)).toBe('Chrome · Android');
    expect(agentLabel(UA.samsung)).toBe('Samsung Internet · Android');
  });

  it('calls a link previewer a preview and other automation a bot, so the counts can leave them out', () => {
    expect(agentLabel(UA.whatsapp)).toBe('Preview · WhatsApp');
    expect(agentLabel(UA.imessage)).toBe('Preview · iMessage or Facebook');
    expect(agentLabel(UA.slack)).toBe('Preview · Slack');
    expect(agentLabel(UA.curl)).toBe('Bot');
    expect(isAutomated('Preview · WhatsApp')).toBe(true);
    expect(isAutomated('Bot')).toBe(true);
    expect(isAutomated('Chrome · Windows')).toBe(false);
    expect(isAutomated(null)).toBe(false);
  });

  it('falls back to Other, and to null for no agent at all', () => {
    expect(agentLabel('SomethingNew/1.0')).toBe('Other');
    expect(agentLabel('SomethingNew/1.0 (Windows NT 10.0)')).toBe('Other · Windows');
    expect(agentLabel('')).toBeNull();
    expect(agentLabel('   ')).toBeNull();
    expect(agentLabel(null)).toBeNull();
  });
});

describe('network prefixes', () => {
  it('an IPv4 address is its /24', () => {
    expect(networkPrefix('198.51.100.7')).toBe('198.51.100.0/24');
    expect(networkPrefix(' 203.0.113.250 ')).toBe('203.0.113.0/24');
  });

  it('an IPv6 address is its /48, however it is written', () => {
    expect(networkPrefix('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
    expect(networkPrefix('2001:0db8:abcd:0012:0000:0000:0000:0001')).toBe('2001:db8:abcd::/48');
    expect(networkPrefix('2001:DB8:ABCD::')).toBe('2001:db8:abcd::/48');
    expect(networkPrefix('2001:db8::1')).toBe('2001:db8:0::/48');
    expect(networkPrefix('fe80::1%eth0')).toBe('fe80:0:0::/48');
  });

  it('an IPv4-mapped IPv6 address is its IPv4 /24, dotted or not', () => {
    expect(networkPrefix('::ffff:198.51.100.7')).toBe('198.51.100.0/24');
    expect(networkPrefix('::FFFF:198.51.100.200')).toBe('198.51.100.0/24');
    expect(networkPrefix('::ffff:c633:6407')).toBe('198.51.100.0/24');
    expect(networkPrefix('::ffff:198.51.100.7')).toBe(networkPrefix('198.51.100.99'));
  });

  it('anything else is no network', () => {
    for (const bad of [null, undefined, '', 'unknown', '198.51.100', '300.1.1.1', '1:2:3', 'a::b::c']) {
      expect(networkPrefix(bad)).toBeNull();
    }
  });
});

function headers(h: Record<string, string>): Headers {
  return new Headers(h);
}

const SECRET = 's'.repeat(40);
const ID = 'AbCdEfGhIjKlMnOpQrStUv';

describe('reading a visit', () => {
  it('hashes the visitor and the network and labels the agent; nothing raw survives', () => {
    const v = readShareVisit(
      headers({
        'x-sr-session-visitor': ID,
        'x-sr-session-visit': '1',
        'x-sr-session-client': '198.51.100.7',
        'x-sr-session-agent': UA.chromeWin,
        'x-sr-session-country': 'GB',
      }),
      SECRET,
    );
    expect(v.open).toBe(true);
    expect(v.visitorHash).toMatch(/^[0-9a-f]{32}$/);
    expect(v.networkHash).toMatch(/^[0-9a-f]{16}$/);
    expect(v).toMatchObject({ agent: 'Chrome · Windows', country: 'GB' });
    const kept = JSON.stringify(v);
    for (const raw of [ID, '198.51.100', 'Mozilla', SECRET]) expect(kept).not.toContain(raw);
  });

  it('is the same visitor and network every time under one secret, and a different one under another', () => {
    const h = { 'x-sr-session-visitor': ID, 'x-sr-session-client': '198.51.100.7' };
    const a = readShareVisit(headers(h), SECRET);
    const b = readShareVisit(headers({ ...h, 'x-sr-session-client': '198.51.100.99' }), SECRET);
    const c = readShareVisit(headers(h), 't'.repeat(40));
    expect(b.visitorHash).toBe(a.visitorHash);
    expect(b.networkHash).toBe(a.networkHash);
    expect(c.visitorHash).not.toBe(a.visitorHash);
    expect(c.networkHash).not.toBe(a.networkHash);
  });

  it('says whether a page opened only when the gateway says so', () => {
    expect(readShareVisit(headers({ 'x-sr-session-visit': '0' }), SECRET).open).toBe(false);
    expect(readShareVisit(headers({ 'x-sr-session-visit': 'yes' }), SECRET).open).toBeNull();
    expect(readShareVisit(headers({}), SECRET).open).toBeNull();
  });

  it('without a visitor id, the network and browser stand in; with nothing at all, no one is counted', () => {
    const one = { 'x-sr-session-client': '198.51.100.7', 'x-sr-session-agent': UA.chromeWin };
    const a = readShareVisit(headers(one), SECRET);
    const b = readShareVisit(headers({ ...one, 'x-sr-session-agent': UA.firefoxMac }), SECRET);
    const bad = readShareVisit(headers({ ...one, 'x-sr-session-visitor': 'not-an-id' }), SECRET);
    expect(a.visitorHash).toMatch(/^[0-9a-f]{32}$/);
    expect(b.visitorHash).not.toBe(a.visitorHash);
    expect(bad.visitorHash).toBe(a.visitorHash);
    const none = readShareVisit(headers({}), SECRET);
    expect(none).toEqual({ open: null, visitorHash: null, networkHash: '', agent: null, country: null });
  });

  it('keeps a country only as two capital letters and a network only from an address', () => {
    const v = readShareVisit(headers({ 'x-sr-session-visitor': ID, 'x-sr-session-country': 'gb', 'x-sr-session-client': 'nope' }), SECRET);
    expect(v.country).toBeNull();
    expect(v.networkHash).toBe('');
  });
});

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 12));
const row = (over: Partial<VisitorRow>): VisitorRow => ({
  browser: 1,
  network: 1,
  agent: 'Chrome · Windows',
  country: 'GB',
  opens: 1,
  firstSeen: day(22),
  lastSeen: day(24),
  ...over,
});

describe('visitor stats', () => {
  it('letters networks A to Z, then AA', () => {
    expect([1, 2, 26, 27, 28, 52, 53].map(networkLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });

  it('shows letters for networks, numbers for browsers, and never a hash', () => {
    const s = visitStats(
      9,
      { rows: 3, opens: 6, browsers: 2, networks: 2, countries: ['IE', 'GB'] },
      [row({ browser: 2, network: 2, country: 'IE' }), row({}), row({ browser: null, network: null, agent: 'Preview · WhatsApp' })],
    );
    expect(s).toMatchObject({ opens: 6, browsers: 2, networks: 2, countries: ['GB', 'IE'], likelyForwarded: false, hidden: 0 });
    expect(s.visitors.map((v) => [v.browser, v.network])).toEqual([
      [2, 'B'],
      [1, 'A'],
      [null, null],
    ]);
    expect(Object.keys(s.visitors[0]).sort()).toEqual(['agent', 'browser', 'country', 'firstSeen', 'lastSeen', 'network', 'opens']);
  });

  it('is likely forwarded at three browsers or three networks, not two', () => {
    const at = (browsers: number, networks: number) =>
      visitStats(0, { rows: 3, opens: 3, browsers, networks, countries: [] }, []).likelyForwarded;
    expect(at(2, 2)).toBe(false);
    expect(at(3, 1)).toBe(true);
    expect(at(1, 3)).toBe(true);
    expect(at(2, 0)).toBe(false);
  });

  it('a link no visitor was recorded for shows its use count, and the rows past the list are counted', () => {
    expect(visitStats(7, undefined, [])).toEqual({
      opens: 7,
      browsers: 0,
      networks: 0,
      countries: [],
      likelyForwarded: false,
      visitors: [],
      hidden: 0,
    });
    expect(visitStats(7, { rows: 60, opens: 80, browsers: 60, networks: 4, countries: [] }, [row({})]).hidden).toBe(59);
  });
});
