import { createHmac, randomUUID } from 'node:crypto';
import { secretsMatch } from '$lib/server/secrets';

/**
 * Installing the iPhone app without TestFlight — the pure half: the links, the
 * enrolment profile, what a phone posts back, and the install manifest.
 * GitHub (where the build lives, and what builds it) is $lib/github/adhoc-builds.
 *
 * TestFlight needs an App Store account of 13 or over, so a younger child's
 * phone cannot use it. An ad-hoc build can go on any phone whose UDID is in the
 * developer account, and Safari installs it from an `itms-services:` link.
 * The UDID is the awkward part: no setting shows it. So the owner makes a
 * join link for a person (`/app/rory-<tag>`); on their phone it offers a
 * one-time "Profile Service" profile, and installing that makes iOS post the
 * UDID back (`/app/<code>/profile`). That starts a build which includes the
 * phone, and Safari lands on `/app` — the one address to come back to, which
 * the join link's cookie lets offer the install.
 *
 * Everything is an HMAC over AUTH_SECRET, not a row: the join code names the
 * person and lasts a week; the install link (`/install/<token>`, which the
 * manifest and the app's own update prompt use) has no expiry, because it is
 * where each new copy is fetched from. A leaked install link fetches an app
 * that installs on none but the listed phones.
 */

/** How long a join link works: long enough to send to the family and for them to get round to it. */
export const JOIN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Bump to retire every install link handed out so far. */
const INSTALL_LINK_VERSION = 1;

/** Apple's limit on a device's name in the developer account. */
export const DEVICE_NAME_MAX = 50;

/** What the install page offers and the manifest names. */
export const APP_TITLE = 'SR';

function sign(secret: string, purpose: string, payload: string): string {
  return createHmac('sha256', secret).update(`${purpose}.${payload}`, 'utf8').digest('base64url');
}

/** The one install link. Throws rather than minting from an empty secret. */
export function installToken(secret: string | undefined): string {
  if (!secret) throw new Error('AUTH_SECRET is required for the install link');
  return sign(secret, 'sr-adhoc-install', `v${INSTALL_LINK_VERSION}`).slice(0, 32);
}

export function isInstallToken(token: unknown, secret: string | undefined): boolean {
  if (!secret || typeof token !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(token)) return false;
  return secretsMatch(installToken(secret), token);
}

/** A device name Apple will take, or null. Letters, digits, spaces and a little punctuation. */
export function cleanDeviceName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const n = name.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  if (!n || n.length > DEVICE_NAME_MAX) return null;
  return /^[\p{L}\p{N} '._-]+$/u.test(n) ? n : null;
}

/**
 * A first name as it appears in a join link: lower-case ASCII letters only, so
 * the link is short and reads aloud ("strangeramblings.com/app/rory-…").
 * "Siobhán" becomes `siobhan`.
 */
export function joinSlug(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const first = name.trim().split(/\s+/)[0] ?? '';
  const slug = first.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  return slug.length >= 1 && slug.length <= 20 ? slug : null;
}

/** "rory" → "Rory". */
export function joinDisplayName(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** What the developer account calls the phone: "Rory's iPhone", or "Rory's iPad". */
export function joinDeviceName(slug: string, product: string | null): string {
  return `${joinDisplayName(slug)}'s ${product?.startsWith('iPad') ? 'iPad' : 'iPhone'}`;
}

function joinTag(secret: string, slug: string, day: number, email: string): string {
  return sign(secret, 'sr-app-join', `${slug}.${day}.${email}`).slice(0, 10);
}

export interface JoinLink {
  slug: string;
  /** Whose link it is — the address the lanes know them by. */
  email: string;
}

/**
 * The owner's say-so for one person, as a link they can be sent:
 * `/app/<slug>-<tag>`. Stateless and short: the tag is an HMAC over the name,
 * the day it was made and the PERSON's address, and it is checked against
 * each of the last JOIN_DAYS days rather than carrying a date. Any phone of
 * theirs may use it. The address is in the signature, not the link: a phone
 * enrolled from it is recorded as theirs (`app_device`), not as a first
 * name's (2026-10-20).
 */
export function mintJoinCode(name: string, secret: string | undefined, email: string, nowMs = Date.now()): string {
  if (!secret) throw new Error('AUTH_SECRET is required for a join link');
  const slug = joinSlug(name);
  if (!slug) throw new Error('A join link needs a first name');
  const e = email.trim().toLowerCase();
  if (!e) throw new Error('A join link needs its person');
  return `${slug}-${joinTag(secret, slug, Math.floor(nowMs / DAY_MS), e)}`;
}

/**
 * Whose join code this is, if it is genuine and under JOIN_DAYS old — tried
 * against each of `candidates` (every address a link could have been minted
 * for, `$lib/server/app-devices.joinCandidates`). Otherwise null.
 */
export function verifyJoinCode(
  code: unknown,
  secret: string | undefined,
  candidates: readonly string[],
  nowMs = Date.now(),
): JoinLink | null {
  if (!secret || typeof code !== 'string') return null;
  const match = /^([a-z]{1,20})-([A-Za-z0-9_-]{10})$/.exec(code);
  if (!match) return null;
  const today = Math.floor(nowMs / DAY_MS);
  for (let day = today; day > today - JOIN_DAYS; day--) {
    for (const candidate of candidates) {
      const email = candidate.trim().toLowerCase();
      if (email && secretsMatch(joinTag(secret, match[1], day, email), match[2])) return { slug: match[1], email };
    }
  }
  return null;
}

/**
 * The cookie a join link leaves in that phone's Safari, so /app — the one
 * address to come back to — knows whose phone it is and can offer the
 * install. Signed: it is what reveals the install link.
 */
export const APP_COOKIE = 'sr_app';

export function appCookie(slug: string, secret: string): string {
  return `${slug}.${sign(secret, 'sr-app-cookie', slug).slice(0, 22)}`;
}

export function readAppCookie(value: unknown, secret: string | undefined): string | null {
  if (!secret || typeof value !== 'string') return null;
  const match = /^([a-z]{1,20})\.([A-Za-z0-9_-]{22})$/.exec(value);
  if (!match) return null;
  return secretsMatch(appCookie(match[1], secret), value) ? match[1] : null;
}

/** Whether a build's device list includes one of this person's phones. */
export function buildIncludes(devices: readonly string[], slug: string): boolean {
  const prefix = `${joinDisplayName(slug)}'s `.toLowerCase();
  return devices.some((d) => d.toLowerCase().startsWith(prefix));
}

/**
 * A UDID as Apple writes it: 25 characters with a dash on phones from 2018 on
 * (`00008110-001A2C3E0E12801E`), 40 hex on older ones. Upper-cased, or null.
 */
export function cleanUdid(udid: unknown): string | null {
  if (typeof udid !== 'string') return null;
  const u = udid.trim().toUpperCase();
  return /^[0-9A-F]{8}-[0-9A-F]{16}$/.test(u) || /^[0-9A-F]{40}$/.test(u) ? u : null;
}

function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PLIST_HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
  '<plist version="1.0">\n';

/**
 * The enrolment profile. Installing it does not leave anything on the phone:
 * a Profile Service payload makes iOS post the attributes it lists to `url`,
 * and the answer to that post (a redirect) ends it.
 */
export function enrolProfile(url: string, name: string): string {
  return (
    PLIST_HEAD +
    '<dict>\n' +
    '  <key>PayloadContent</key>\n' +
    '  <dict>\n' +
    `    <key>URL</key><string>${xml(url)}</string>\n` +
    '    <key>DeviceAttributes</key>\n' +
    '    <array><string>UDID</string><string>PRODUCT</string><string>VERSION</string><string>DEVICE_NAME</string></array>\n' +
    '  </dict>\n' +
    '  <key>PayloadOrganization</key><string>Strange Ramblings</string>\n' +
    `  <key>PayloadDisplayName</key><string>${xml(`Install SR on ${name}`)}</string>\n` +
    '  <key>PayloadDescription</key><string>Tells strangeramblings.com this phone’s ID so the app can be built for it. Nothing is left installed.</string>\n' +
    '  <key>PayloadIdentifier</key><string>com.strangeramblings.install.enrol</string>\n' +
    `  <key>PayloadUUID</key><string>${randomUUID().toUpperCase()}</string>\n` +
    '  <key>PayloadType</key><string>Profile Service</string>\n' +
    '  <key>PayloadVersion</key><integer>1</integer>\n' +
    '</dict>\n' +
    '</plist>\n'
  );
}

export type EnrolledDevice = { udid: string; product: string | null; version: string | null; deviceName: string | null };

/**
 * What iOS posts back: the attributes as a plist, inside a CMS envelope signed
 * by the phone. The plist sits in the envelope as plain bytes, so it is read
 * straight out. The signature is not checked — it proves only that SOME Apple
 * device sent it, and the ticket in the URL is what says the owner asked.
 */
export function parseEnrolment(body: Uint8Array): EnrolledDevice | null {
  const text = Buffer.from(body).toString('latin1');
  const start = text.indexOf('<?xml');
  const end = text.indexOf('</plist>', start);
  if (start < 0 || end < 0) return null;
  const plist = text.slice(start, end);
  const field = (key: string): string | null => {
    const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist);
    return m ? Buffer.from(m[1], 'latin1').toString('utf8').trim() || null : null;
  };
  const udid = cleanUdid(field('UDID'));
  if (!udid) return null;
  const product = field('PRODUCT');
  // An iPhone, iPad or iPod touch: what an iOS ad-hoc profile can hold.
  if (product && !/^(iPhone|iPad|iPod)\d/.test(product)) return null;
  return { udid, product, version: field('VERSION'), deviceName: field('DEVICE_NAME') };
}

/** The `itms-services:` manifest Safari reads before it fetches the app. */
export function installManifest(ipaUrl: string, bundleId: string, version: string): string {
  return (
    PLIST_HEAD +
    '<dict>\n' +
    '  <key>items</key>\n' +
    '  <array>\n' +
    '    <dict>\n' +
    '      <key>assets</key>\n' +
    '      <array><dict><key>kind</key><string>software-package</string>' +
    `<key>url</key><string>${xml(ipaUrl)}</string></dict></array>\n` +
    '      <key>metadata</key>\n' +
    '      <dict>\n' +
    `        <key>bundle-identifier</key><string>${xml(bundleId)}</string>\n` +
    `        <key>bundle-version</key><string>${xml(version)}</string>\n` +
    '        <key>kind</key><string>software</string>\n' +
    `        <key>title</key><string>${APP_TITLE}</string>\n` +
    '      </dict>\n' +
    '    </dict>\n' +
    '  </array>\n' +
    '</dict>\n' +
    '</plist>\n'
  );
}

/** The link Safari opens to install. */
export function itmsLink(manifestUrl: string): string {
  return `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
}
