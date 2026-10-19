import { createHmac, randomUUID } from 'node:crypto';
import { secretsMatch } from '$lib/server/secrets';

/**
 * Installing the iPhone app without TestFlight — the pure half: the links, the
 * enrolment profile, what a phone posts back, and the install manifest.
 * GitHub (where the build lives, and what builds it) is ./adhoc-builds.
 *
 * TestFlight needs an App Store account of 13 or over, so a younger child's
 * phone cannot use it. An ad-hoc build can go on any phone whose UDID is in the
 * developer account, and Safari installs it from an `itms-services:` link.
 * The UDID is the awkward part: no setting shows it. So the owner makes an
 * enrolment link for the phone; Safari on the phone downloads a one-time
 * "Profile Service" profile, and installing it makes iOS post the UDID back
 * here (`/install/enroll/<ticket>`). That starts a build which includes the
 * phone, and the phone is sent on to the install page (`/install/<token>`).
 *
 * Both links are HMACs over AUTH_SECRET, not rows: the enrolment ticket names
 * the phone and lasts a day; the install link has no expiry, because the same
 * page is where each new copy is fetched from. A leaked install link fetches
 * an app that installs on none but the listed phones.
 */

/** How long an enrolment link works. Long enough to hand it over by message. */
export const ENROL_TTL_MS = 24 * 60 * 60 * 1000;

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

/** A link for one phone, named as it will appear in the developer account. */
export function mintEnrolTicket(name: string, secret: string | undefined, nowMs = Date.now()): string {
  if (!secret) throw new Error('AUTH_SECRET is required for an enrolment link');
  const n = cleanDeviceName(name);
  if (!n) throw new Error('A phone needs a short plain name');
  const payload = Buffer.from(JSON.stringify({ n, x: nowMs + ENROL_TTL_MS })).toString('base64url');
  return `${payload}.${sign(secret, 'sr-adhoc-enrol', payload)}`;
}

/** The phone's name if the ticket is genuine and unexpired, otherwise null. */
export function verifyEnrolTicket(ticket: unknown, secret: string | undefined, nowMs = Date.now()): string | null {
  if (!secret || typeof ticket !== 'string' || ticket.length > 512) return null;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(ticket);
  if (!match) return null;
  if (!secretsMatch(sign(secret, 'sr-adhoc-enrol', match[1]), match[2])) return null;
  let claims: { n?: unknown; x?: unknown };
  try {
    claims = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims.x !== 'number' || claims.x < nowMs || claims.x > nowMs + ENROL_TTL_MS) return null;
  return cleanDeviceName(claims.n);
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
