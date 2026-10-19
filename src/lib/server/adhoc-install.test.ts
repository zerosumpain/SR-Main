import { describe, expect, it } from 'vitest';
import {
  cleanDeviceName,
  cleanUdid,
  ENROL_TTL_MS,
  enrolProfile,
  installManifest,
  installToken,
  isInstallToken,
  itmsLink,
  mintEnrolTicket,
  parseEnrolment,
  verifyEnrolTicket,
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

describe('an enrolment ticket', () => {
  it('names its phone for a day, and no longer', () => {
    const now = Date.UTC(2026, 9, 19, 12);
    const ticket = mintEnrolTicket('Rory’s iPhone', SECRET, now);
    expect(verifyEnrolTicket(ticket, SECRET, now + 1000)).toBe("Rory's iPhone");
    expect(verifyEnrolTicket(ticket, SECRET, now + ENROL_TTL_MS + 1)).toBeNull();
    expect(verifyEnrolTicket(ticket, 'other'.padEnd(40, 'z'), now)).toBeNull();
  });

  it('cannot be re-signed with a different name', () => {
    const now = Date.now();
    const ticket = mintEnrolTicket('Rory', SECRET, now);
    const forged = Buffer.from(JSON.stringify({ n: 'Mallory', x: now + 1000 })).toString('base64url');
    expect(verifyEnrolTicket(`${forged}.${ticket.split('.')[1]}`, SECRET, now)).toBeNull();
  });

  it('only takes names Apple will', () => {
    expect(cleanDeviceName('  Rory  iPhone ')).toBe('Rory iPhone');
    expect(cleanDeviceName('<script>')).toBeNull();
    expect(cleanDeviceName('x'.repeat(51))).toBeNull();
    expect(() => mintEnrolTicket('', SECRET)).toThrow();
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
