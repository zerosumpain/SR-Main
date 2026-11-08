// Who is opening a share link (24 Oct 2026). John: "can i track whether a link
// has been likely shared and opened by multiple users?" The gateway in front of
// a project application tells Main's session authority, on its own
// authenticated call, a random visitor id it keeps in a cookie, the client
// address, the User-Agent, Cloudflare's country and whether the request opened
// a page (SR-Infra gateway/session.mjs). This file turns that into what Main
// keeps, and keeps nothing raw: the id and the address's network are HMACs
// under a key derived from AUTH_SECRET, the agent a label like "Safari ·
// iPhone". Pure, so the rules are pinned by share-visitor.test.ts; the rows are
// written and read in ./share-visits.
//
// It is an estimate and says so in the Share panel: one person on a phone and
// a laptop is two browsers, a household behind one router is one network.

import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

/** What one request tells the visitor count. Hashes and a label only. */
export interface ShareVisit {
  /**
   * True when the request opened a page, false for the page's own data
   * requests, null when the gateway did not say (one from before visitors),
   * and then every request counts toward the link's use as it always did.
   */
  open: boolean | null;
  /** Who, hashed: the visitor cookie, else the network and browser together; null when nothing came. */
  visitorHash: string | null;
  /** The address's /24 or /48, hashed; '' when no address came. */
  networkHash: string;
  agent: string | null;
  country: string | null;
}

/** The gateway's visitor id: 16 random bytes, base64url. */
const VISITOR_ID = /^[A-Za-z0-9_-]{22}$/;
const MAX_AGENT = 256;

/** The visit key, derived from AUTH_SECRET so these hashes match nothing else the site keys. */
export function visitKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('sr-project-share-visit/v1').digest();
}

function mac(key: Buffer, input: string): string {
  return createHmac('sha256', key).update(input).digest('hex');
}

/** The eight groups of an IPv6 address, or null. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip;
  let tail: number[] = [];
  // A dotted IPv4 tail (::ffff:198.51.100.7) is the last two groups.
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    if (isIP(dotted[2]) !== 4) return null;
    const [a, b, c, d] = dotted[2].split('.').map(Number);
    tail = [(a << 8) | b, (c << 8) | d];
    text = dotted[1].endsWith('::') ? dotted[1] : dotted[1].slice(0, -1);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const part = (s: string) => (s ? s.split(':').map((g) => parseInt(g, 16)) : []);
  const head = part(halves[0]);
  const rest = halves.length === 2 ? part(halves[1]) : [];
  const fill = 8 - tail.length - head.length - rest.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const groups = [...head, ...Array(fill).fill(0), ...rest, ...tail];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * The network an address sits on: its IPv4 /24, or its IPv6 /48 (one site, as
 * ISPs hand them out). An IPv4-mapped IPv6 address (::ffff:1.2.3.4, as a dual
 * stack socket reports one) is its IPv4. Null for anything that is not an address.
 */
export function networkPrefix(raw: string | null | undefined): string | null {
  const ip = (raw ?? '').trim().replace(/%.*$/, '');
  const kind = isIP(ip);
  if (kind === 4) return ip.split('.').slice(0, 3).join('.') + '.0/24';
  if (kind !== 6) return null;
  const g = ipv6Groups(ip.toLowerCase());
  if (!g) return null;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.0/24`;
  }
  return g.slice(0, 3).map((x) => x.toString(16)).join(':') + '::/48';
}

/** Link previewers: they fetch the page the moment a link is pasted, and are nobody. */
const PREVIEWERS: [RegExp, string][] = [
  [/WhatsApp/i, 'WhatsApp'],
  [/Slackbot/i, 'Slack'],
  [/TelegramBot/i, 'Telegram'],
  [/Discordbot/i, 'Discord'],
  [/LinkedInBot/i, 'LinkedIn'],
  // Apple's Messages previews a link as facebookexternalhit, so the two read as one.
  [/facebookexternalhit|Facebot|meta-externalagent/i, 'iMessage or Facebook'],
  [/Twitterbot/i, 'X'],
  [/SkypeUriPreview/i, 'Teams'],
  [/Googlebot|Google-InspectionTool|GoogleOther/i, 'Google'],
  [/bingbot|BingPreview/i, 'Bing'],
  [/Applebot/i, 'Apple'],
];
const AUTOMATION = /bot\/|crawl|spider|slurp|preview|headless|curl\/|wget\/|python-|httpx|aiohttp|go-http-client|okhttp|node-fetch|undici|axios|java\/|libwww|scrapy/i;
// A bare "…bot" names a bot only when no browser is named: handsets are called
// things like CUBOT X30, and their Chrome is a person.
const LOOSE_BOT = /bot\b/i;

/** The label prefix for a link previewer, and the label for any other automation. */
export const PREVIEW_LABEL = 'Preview';
export const BOT_LABEL = 'Bot';

/** Does this stored label name a previewer or a bot, which the counts leave out? */
export function isAutomated(agent: string | null): boolean {
  return agent === BOT_LABEL || (agent ?? '').startsWith(`${PREVIEW_LABEL} ·`);
}

function browserOf(ua: string): string | null {
  if (/\bEdg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/\bOPR\/|\bOpera\b/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return 'Firefox';
  if (/\bChrome\/|\bCriOS\/|\bChromium\//.test(ua)) return 'Chrome';
  if (/\bVersion\/[\d.]+.*\bSafari\//.test(ua) || /\b(iPhone|iPad)\b.*AppleWebKit/.test(ua)) return 'Safari';
  return null;
}

function systemOf(ua: string): string | null {
  if (/\biPhone\b/.test(ua)) return 'iPhone';
  if (/\biPad\b/.test(ua)) return 'iPad';
  if (/\bAndroid\b/.test(ua)) return 'Android';
  if (/\bWindows\b/.test(ua)) return 'Windows';
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS';
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return 'macOS';
  if (/\bLinux\b/.test(ua)) return 'Linux';
  return null;
}

/**
 * A short label for a User-Agent, the only part of it kept: "Chrome ·
 * Windows", "Safari · iPhone", "Preview · WhatsApp", "Bot", "Other". Null when
 * there was none.
 */
export function agentLabel(raw: string | null | undefined): string | null {
  const ua = (raw ?? '').slice(0, MAX_AGENT).trim();
  if (!ua) return null;
  for (const [pattern, name] of PREVIEWERS) if (pattern.test(ua)) return `${PREVIEW_LABEL} · ${name}`;
  if (AUTOMATION.test(ua)) return BOT_LABEL;
  const browser = browserOf(ua);
  if (!browser && LOOSE_BOT.test(ua)) return BOT_LABEL;
  const system = systemOf(ua);
  if (browser && system) return `${browser} · ${system}`;
  if (browser) return browser;
  return system ? `Other · ${system}` : 'Other';
}

/**
 * What the gateway's x-sr-session-* headers say about this request, hashed
 * and labelled. Every header is optional: an older gateway sends none, and
 * the answer then counts every request as before and tells no one apart.
 */
export function readShareVisit(headers: Headers, secret: string): ShareVisit {
  const key = visitKey(secret);
  const said = headers.get('x-sr-session-visit');
  const open = said === '1' ? true : said === '0' ? false : null;
  const id = headers.get('x-sr-session-visitor') ?? '';
  const rawAgent = (headers.get('x-sr-session-agent') ?? '').slice(0, MAX_AGENT).trim();
  const network = networkPrefix(headers.get('x-sr-session-client'));
  const country = headers.get('x-sr-session-country') ?? '';
  // No cookie id: the network and the browser together are a rough stand-in.
  const visitorHash = VISITOR_ID.test(id)
    ? mac(key, `visitor:${id}`).slice(0, 32)
    : network || rawAgent
      ? mac(key, `network-agent:${network ?? ''}\n${rawAgent}`).slice(0, 32)
      : null;
  return {
    open,
    visitorHash,
    networkHash: network ? mac(key, `network:${network}`).slice(0, 16) : '',
    agent: agentLabel(rawAgent),
    country: /^[A-Z]{2}$/.test(country) ? country : null,
  };
}

/** A link's visitor numbers, as the Share panel shows them. Never a hash. */
export interface ShareVisitStats {
  /**
   * The link's opens: its use count, which goes back before visitors were
   * recorded and past the row cap, or the people's own opens if ever higher.
   * Previewers count here, as they always have; the browsers and networks leave them out.
   */
  opens: number;
  browsers: number;
  networks: number;
  countries: string[];
  /** Three or more browsers, or three or more networks. */
  likelyForwarded: boolean;
  /** The newest 50 rows, latest first. */
  visitors: ShareVisitor[];
  /** Older rows not listed. */
  hidden: number;
}

export interface ShareVisitor {
  /** "Browser 1", "Browser 2" … in the order they first came; null for a previewer or bot. */
  browser: number | null;
  /** "A", "B" … per network in the order they first came; null when there was no address. */
  network: string | null;
  agent: string | null;
  country: string | null;
  opens: number;
  firstSeen: Date;
  lastSeen: Date;
}

export const FORWARDED_AT = 3;

/** 1 → A, 26 → Z, 27 → AA: a network's letter within its link. */
export function networkLetter(n: number): string {
  let out = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) out = String.fromCharCode(65 + ((k - 1) % 26)) + out;
  return out;
}

/** One link's counts as the database adds them up (./share-visits). */
export interface VisitTotals {
  rows: number;
  opens: number;
  browsers: number;
  networks: number;
  countries: string[];
}

/** One visitor row as ./share-visits reads it: ranks, never hashes. */
export interface VisitorRow {
  browser: number | null;
  network: number | null;
  agent: string | null;
  country: string | null;
  opens: number;
  firstSeen: Date;
  lastSeen: Date;
}

/**
 * The Share panel's numbers for one link. The headline count never moves to the
 * visitor rows: a link opened 37 times before this would read "opened 1×" the
 * first time someone was recorded, and a link only a previewer has fetched
 * "opened 0×" beside a last-used date.
 */
export function visitStats(useCount: number, totals: VisitTotals | undefined, rows: VisitorRow[]): ShareVisitStats {
  const t = totals ?? { rows: 0, opens: 0, browsers: 0, networks: 0, countries: [] };
  return {
    opens: Math.max(useCount, t.opens),
    browsers: t.browsers,
    networks: t.networks,
    countries: [...t.countries].sort(),
    likelyForwarded: t.browsers >= FORWARDED_AT || t.networks >= FORWARDED_AT,
    visitors: rows.map((r) => ({
      browser: r.browser,
      network: r.network ? networkLetter(r.network) : null,
      agent: r.agent,
      country: r.country,
      opens: r.opens,
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
    })),
    hidden: Math.max(0, t.rows - rows.length),
  };
}
