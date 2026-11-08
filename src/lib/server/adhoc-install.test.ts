import { describe, expect, it } from 'vitest';
import {
  appCookie,
  buildIncludes,
  buildQuery,
  cleanDeviceName,
  cleanUdid,
  enrolProfile,
  installManifest,
  installToken,
  isInstallToken,
  isJoinCode,
  itmsLink,
  joinDeviceName,
  joinSlug,
  mintJoinCode,
  parseEnrolment,
  readAppCookie,
  requestedBuild,
  verifyJoinCode,
} from './adhoc-install';

// The links and documents behind /install: a child's phone, which TestFlight
// will not take, tells the site its UDID and installs an ad-hoc copy.

const SECRET = 'adhoc-test-secret'.padEnd(40, 'x');
const UDID = '00008110-001A2C3E0E12801E';

/** What iOS posts: the plist, wrapped in a signed CMS envelope (bytes around it). */
function posted(fields: Record<string, string>): Uint8Array {
  const dict = Object.entries(fields).map(([k, v]) => `<key>${k}</key>\n\t<string>${v}</string>`).join('\n\t');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t${dict}\n</dict>\n</plist>\n`;
  return Buffer.concat([Buffer.from([0x30, 0x80, 0x06, 0x09, 0x2a, 0x86]), Buffer.from(plist, 'utf8'), Buffer.from([0xa0, 0x82, 0x0b, 0x00])]);
}

describe('the install link', () => {
  it('is the same every time, and only it opens the page', () => {
    const token = installToken(SECRET);
    expect(token).toHaveLength(32);
    expect(installToken(SECRET)).toBe(token);
    expect(isInstallToken(token, SECRET)).toBe(true);
    expect(isInstallToken(installToken('another-secret'.padEnd(40, 'y')), SECRET)).toBe(false);
    expect(isInstallToken(token, undefined)).toBe(false);
    const flipped = `${token.slice(0, 31)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(isInstallToken(flipped, SECRET)).toBe(false);
  });

  it('refuses to mint from no secret', () => {
    expect(() => installToken('')).toThrow();
  });
});

describe('the install link for one build (a build sent to one phone)', () => {
  const params = (q: string) => new URLSearchParams(q);

  it('names the released copy when it names no build', () => {
    expect(requestedBuild(params(''), SECRET)).toBeNull();
  });

  it('opens the build its key was signed for, and no other', () => {
    expect(requestedBuild(params(buildQuery(SECRET, 131)), SECRET)).toBe(131);
    const key = params(buildQuery(SECRET, 131)).get('key');
    expect(requestedBuild(params(`build=132&key=${key}`), SECRET)).toBe(false);
    expect(requestedBuild(params(buildQuery('another-secret'.padEnd(40, 'y'), 131)), SECRET)).toBe(false);
  });

  it('refuses a build with no key, a bad number, or no secret', () => {
    expect(requestedBuild(params('build=131'), SECRET)).toBe(false);
    expect(requestedBuild(params('build=abc&key=x'), SECRET)).toBe(false);
    expect(requestedBuild(params(buildQuery(SECRET, 131)), undefined)).toBe(false);
  });
});

describe('a join link', () => {
  const DAY = 86_400_000;

  const RORY = 'rory@example.test';
  const KNOWN = ['fintan@example.test', 'Rory@Example.test', 'owner@example.test'];

  it('is short, names its person, and lasts a week', () => {
    const now = Date.UTC(2026, 9, 19, 12);
    const code = mintJoinCode('Rory', SECRET, RORY, 'identity', now);
    expect(code).toMatch(/^rory-[A-Za-z0-9_-]{10}$/);
    expect(verifyJoinCode(code, SECRET, KNOWN, now)).toEqual({ slug: 'rory', email: RORY, mode: 'identity' });
    expect(verifyJoinCode(code, SECRET, KNOWN, now + 6 * DAY)).toEqual({ slug: 'rory', email: RORY, mode: 'identity' });
    expect(verifyJoinCode(code, SECRET, KNOWN, now + 8 * DAY)).toBeNull();
    expect(verifyJoinCode(code, 'other'.padEnd(40, 'z'), KNOWN, now)).toBeNull();
  });

  it('carries, unseen, whether it pairs with a sign-in or on the owner’s word', () => {
    const now = Date.now();
    const vouched = mintJoinCode('Rory', SECRET, RORY, 'vouch', now);
    expect(vouched).toMatch(/^rory-[A-Za-z0-9_-]{10}$/);
    expect(vouched).not.toBe(mintJoinCode('Rory', SECRET, RORY, 'identity', now));
    expect(verifyJoinCode(vouched, SECRET, KNOWN, now)).toEqual({ slug: 'rory', email: RORY, mode: 'vouch' });
    expect(isJoinCode(vouched)).toBe(true);
    expect(isJoinCode('C'.repeat(43))).toBe(false);
  });

  it('cannot be moved onto another name, or another person', () => {
    const now = Date.now();
    const tag = mintJoinCode('Rory', SECRET, RORY, 'identity', now).split('-')[1];
    expect(verifyJoinCode(`fintan-${tag}`, SECRET, KNOWN, now)).toBeNull();
    expect(verifyJoinCode('rory-0123456789', SECRET, KNOWN, now)).toBeNull();
    // A person the site does not know cannot have been given a link.
    expect(verifyJoinCode(`rory-${tag}`, SECRET, ['fintan@example.test'], now)).toBeNull();
    expect(verifyJoinCode(`rory-${tag}`, SECRET, [], now)).toBeNull();
  });

  it('takes a first name and makes it plain', () => {
    expect(joinSlug('Siobhán Kelly')).toBe('siobhan');
    expect(joinSlug('  Rory ')).toBe('rory');
    expect(joinSlug('42')).toBeNull();
    expect(() => mintJoinCode('', SECRET, RORY)).toThrow();
    expect(() => mintJoinCode('Rory', SECRET, ' ')).toThrow();
    expect(joinDeviceName('rory', 'iPhone15,2')).toBe("Rory's iPhone");
    expect(joinDeviceName('rory', 'iPad13,1')).toBe("Rory's iPad");
  });

  it('leaves a signed cookie that only it could have made', () => {
    const cookie = appCookie('rory', SECRET);
    expect(readAppCookie(cookie, SECRET)).toBe('rory');
    expect(readAppCookie(cookie.replace('rory', 'fintan'), SECRET)).toBeNull();
    expect(readAppCookie(cookie, 'other'.padEnd(40, 'z'))).toBeNull();
  });

  it('knows whether a copy includes one of their phones', () => {
    expect(buildIncludes(["Porks Talking Tool", "Rory's iPhone"], 'rory')).toBe(true);
    expect(buildIncludes(["Rory's iPhone"], 'ro')).toBe(false);
  });

  it('still only takes device names Apple will', () => {
    expect(cleanDeviceName('  Rory  iPhone ')).toBe('Rory iPhone');
    expect(cleanDeviceName('<script>')).toBeNull();
    expect(cleanDeviceName('x'.repeat(51))).toBeNull();
  });
});

describe('a UDID', () => {
  it('in both of the shapes Apple uses', () => {
    expect(cleanUdid(UDID.toLowerCase())).toBe(UDID);
    expect(cleanUdid('a'.repeat(40))).toBe('A'.repeat(40));
    expect(cleanUdid('00008110001A2C3E0E12801E')).toBeNull();
    expect(cleanUdid('not a udid')).toBeNull();
  });
});

describe('the enrolment profile', () => {
  it('asks iOS for the UDID, to be posted back to its own link', () => {
    const profile = enrolProfile('https://strangeramblings.com/install/enroll/t.s', "Rory's iPhone");
    expect(profile).toContain('<key>PayloadType</key><string>Profile Service</string>');
    expect(profile).toContain('<key>URL</key><string>https://strangeramblings.com/install/enroll/t.s</string>');
    expect(profile).toContain('<string>UDID</string>');
    expect(profile).toContain("Install SR on Rory's iPhone");
  });
});

describe('what the phone posts back', () => {
  it('is read out of its envelope', () => {
    expect(parseEnrolment(posted({ PRODUCT: 'iPhone15,2', UDID, VERSION: '23A341', DEVICE_NAME: 'Rory’s iPhone' }))).toEqual({
      udid: UDID,
      product: 'iPhone15,2',
      version: '23A341',
      deviceName: 'Rory’s iPhone',
    });
  });

  it('is refused without a UDID, or from something an iOS profile cannot hold', () => {
    expect(parseEnrolment(posted({ PRODUCT: 'iPhone15,2' }))).toBeNull();
    expect(parseEnrolment(posted({ PRODUCT: 'Watch6,1', UDID }))).toBeNull();
    expect(parseEnrolment(Buffer.from('nothing here'))).toBeNull();
  });
});

describe('the install manifest', () => {
  it('names the app and where to fetch it, escaped', () => {
    const m = installManifest('https://strangeramblings.com/install/t/app.ipa?a=1&b=2', 'com.example.app', '0.1.42');
    expect(m).toContain('<string>software-package</string><key>url</key><string>https://strangeramblings.com/install/t/app.ipa?a=1&amp;b=2</string>');
    expect(m).toContain('<key>bundle-identifier</key><string>com.example.app</string>');
    expect(m).toContain('<key>bundle-version</key><string>0.1.42</string>');
    expect(itmsLink('https://x.test/m.plist')).toBe('itms-services://?action=download-manifest&url=https%3A%2F%2Fx.test%2Fm.plist');
  });
});
