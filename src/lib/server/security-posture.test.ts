import { describe, it, expect } from 'vitest';
import {
  parseSshd,
  parseFail2banStatus,
  parseIgnoreIps,
  isValidIp,
  parseExposure,
} from './security-posture';

// Fixtures are verbatim output captured from the two real hosts on 2026-08-12,
// so a parser change that stops handling the actual format fails here rather
// than showing "unknown" on the panel during an incident.

const VPS_SSHD = `port 22
addressfamily any
permitrootlogin no
maxauthtries 6
pubkeyauthentication yes
passwordauthentication no
permitemptypasswords no
usepam yes`;

const HOMESERV_SSHD = `port 22
permitrootlogin without-password
maxauthtries 3
pubkeyauthentication yes
passwordauthentication yes
permitemptypasswords no`;

const F2B_STATUS = `Status for the jail: sshd
|- Filter
|  |- Currently failed:\t0
|  |- Total failed:\t3
|  \`- Journal matches:\t_SYSTEMD_UNIT=ssh.service + _COMM=sshd
\`- Actions
   |- Currently banned:\t2
   |- Total banned:\t7
   \`- Banned IP list:\t118.139.164.171 45.148.10.99`;

const F2B_IGNORE = `These IP addresses/networks are ignored:
|- 127.0.0.0/8
|- 100.64.0.0/10
|- ::1
\`- 90.208.50.64`;

describe('parseSshd', () => {
  it('reads the VPS posture: password auth off, root login off', () => {
    const p = parseSshd(VPS_SSHD);
    expect(p.passwordAuthentication).toBe(false);
    expect(p.permitRootLogin).toBe('no');
    expect(p.pubkeyAuthentication).toBe(true);
    expect(p.port).toBe('22');
  });

  it('reads the homeserv posture: password auth on', () => {
    const p = parseSshd(HOMESERV_SSHD);
    expect(p.passwordAuthentication).toBe(true);
    expect(p.permitRootLogin).toBe('without-password');
    expect(p.maxAuthTries).toBe('3');
  });

  // A missing keyword must read as "unknown", never as a confident false —
  // reporting password auth as OFF when we simply could not tell would be the
  // most dangerous possible bug in this panel.
  it('returns null for keywords it cannot find, not false', () => {
    const p = parseSshd('port 22');
    expect(p.passwordAuthentication).toBeNull();
    expect(p.permitRootLogin).toBeNull();
  });
});

describe('parseFail2banStatus', () => {
  it('extracts counts and the actual addresses', () => {
    const p = parseFail2banStatus(F2B_STATUS, 'sshd');
    expect(p.currentlyBanned).toBe(2);
    expect(p.totalBanned).toBe(7);
    expect(p.bannedIps).toEqual(['118.139.164.171', '45.148.10.99']);
  });

  it('handles an empty ban list without inventing entries', () => {
    const p = parseFail2banStatus(
      F2B_STATUS.replace('118.139.164.171 45.148.10.99', ''),
      'sshd',
    );
    expect(p.bannedIps).toEqual([]);
  });
});

describe('parseIgnoreIps', () => {
  it('strips the tree drawing characters and keeps the networks', () => {
    expect(parseIgnoreIps(F2B_IGNORE)).toEqual([
      '127.0.0.0/8',
      '100.64.0.0/10',
      '::1',
      '90.208.50.64',
    ]);
  });

  it('drops the prose header line', () => {
    expect(parseIgnoreIps(F2B_IGNORE)).not.toContain('These IP addresses/networks are ignored:');
  });
});

// The unban action passes this straight to a root command, so it is the one
// input in the module that must not be trusted.
describe('isValidIp', () => {
  it.each(['1.2.3.4', '255.255.255.255', '90.208.50.64', '2001:db8::1', '::1'])(
    'accepts %s',
    (ip) => expect(isValidIp(ip)).toBe(true),
  );

  it.each([
    '1.2.3.256',
    '1.2.3',
    'localhost',
    '1.2.3.4; rm -rf /',
    '$(whoami)',
    '1.2.3.4 --flag',
    '',
  ])('rejects %s', (ip) => expect(isValidIp(ip)).toBe(false));
});

// `-o cat` output: no timestamp or host prefix, the message only. Captured from
// the VPS, where the exposure read silently returned null for weeks' worth of
// attacks because 1.35MB of journal blew execFile's 1MB default maxBuffer —
// the panel showed "unknown" on the one host actually under attack.
const JOURNAL_CAT = `Invalid user sol from 195.178.110.30 port 60792
Failed password for invalid user sol from 195.178.110.30 port 60792 ssh2
Invalid user admin from 118.139.164.171 port 41022
Failed password for root from 45.148.10.99 port 55110 ssh2
Accepted publickey for johnk from 90.208.50.64 port 51234 ssh2
Connection closed by 195.178.110.30 port 60792 [preauth]`;

describe('parseExposure', () => {
  it('counts only failures, not the successful login or the noise', () => {
    const e = parseExposure(JOURNAL_CAT, 24);
    expect(e.failedAttempts).toBe(4);
  });

  it('counts distinct attacking addresses', () => {
    expect(parseExposure(JOURNAL_CAT, 24).distinctSourceIps).toBe(3);
  });

  it('reports a quiet host as genuinely zero — the homeserv case', () => {
    const e = parseExposure('', 24);
    expect(e.failedAttempts).toBe(0);
    expect(e.distinctSourceIps).toBe(0);
  });

  it('carries the window through so the UI can say "in 24h"', () => {
    expect(parseExposure('', 168).windowHours).toBe(168);
  });
});
