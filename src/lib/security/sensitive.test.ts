import { describe, it, expect } from 'vitest';
import {
  findSensitive,
  hasSensitive,
  redactSensitive,
  redactDeep,
} from './sensitive';

describe('credentials', () => {
  it('catches the vendor key formats', () => {
    const cases: [string, string][] = [
      ['sk-or-v1-0123456789abcdef0123456789abcdef', 'api-key'],
      ['sk-proj-abcdefghijklmnopqrstuvwxyz012345', 'api-key'],
      ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz01', 'api-key'],
      ['AIzaSyA1234567890abcdefghijklmnopqrstuvw', 'api-key'],
      ['AKIAIOSFODNN7EXAMPLE', 'api-key'],
      ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'token'],
      ['github_pat_11ABCDEFG0abcdefghijklmnop', 'token'],
      ['xoxb-123456789012-abcdefghijkl', 'token'],
    ];
    for (const [value, kind] of cases) {
      const hits = findSensitive(`the key is ${value} ok`);
      expect(hits.length, value).toBeGreaterThan(0);
      expect(hits[0].kind, value).toBe(kind);
    }
  });

  it('catches a private key header and a JWT', () => {
    expect(hasSensitive('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true);
    expect(
      hasSensitive('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r'),
    ).toBe(true);
  });

  it('does not flag an env-var NAME used as documentation', () => {
    // "Bearer SCRAPER_SERVICE_TOKEN" appears in the real release log and is a
    // description of the header, not a credential.
    expect(hasSensitive('authenticates via Bearer SCRAPER_SERVICE_TOKEN.')).toBe(false);
  });

  it('does not flag a git sha as a secret', () => {
    const hits = findSensitive('deployed e53c1ab256151b8905975c15426f3984d51eb09c');
    expect(hits.filter((h) => h.kind === 'api-key' || h.kind === 'token')).toEqual([]);
  });
});

describe('personal data', () => {
  it('catches the phone number that actually leaked', () => {
    const hits = findSensitive(
      "Panel-formatted numbers like '+44 7359228511' retained the space.",
    );
    expect(hits[0].kind).toBe('phone');
    expect(hits[0].value).toContain('7359228511');
  });

  it('catches phone numbers in national and unpunctuated form', () => {
    expect(hasSensitive('called 07359228511 twice')).toBe(true);
    expect(hasSensitive('jid 7359228511@s.whatsapp.net')).toBe(true);
    expect(hasSensitive('+447359228511')).toBe(true);
  });

  it('catches emails, postcodes, coordinates and IPs', () => {
    expect(findSensitive('mail john@example.com')[0].kind).toBe('email');
    expect(findSensitive('geocode NR12 8TB failed')[0].kind).toBe('postcode');
    expect(findSensitive('marker at 52.6301, 1.2974')[0].kind).toBe('coordinates');
    expect(findSensitive('bound to 192.168.0.57')[0].kind).toBe('ip');
  });

  it('leaves ordinary numbers in prose alone', () => {
    expect(hasSensitive('renders 1,056 rows in 200ms')).toBe(false);
    expect(hasSensitive('raised the cap from 300 to 3000 tokens')).toBe(false);
    expect(hasSensitive('backfilled 403 releases')).toBe(false);
    expect(hasSensitive('a 2026-03-19 boundary')).toBe(false);
  });
});

describe('exemptions', () => {
  it('ignores the Claude Code co-author trailer', () => {
    expect(hasSensitive('Co-Authored-By: Claude <noreply@anthropic.com>')).toBe(false);
    expect(hasSensitive('noreply@github.com')).toBe(false);
  });

  it('still flags a real personal address', () => {
    expect(findSensitive('johnkelly.main@gmail.com')[0].kind).toBe('email');
    expect(findSensitive('someone@anthropic.com')[0].kind).toBe('email');
  });

  it('ignores a YYYYMMDD stamp inside a model identifier', () => {
    expect(hasSensitive('pinned to claude-haiku-4-5-20251001')).toBe(false);
  });

  it('does not let the date exemption shelter a real identifier', () => {
    expect(hasSensitive('account 20259999')).toBe(true); // month 99
    expect(hasSensitive('id 7359228511')).toBe(true);
  });
});

describe('span resolution', () => {
  it('reports a phone number as a phone, not as a digit run', () => {
    const hits = findSensitive('+44 7359228511');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('phone');
  });

  it('returns matches in document order', () => {
    const hits = findSensitive('mail a@b.co then call 07359228511');
    expect(hits.map((h) => h.kind)).toEqual(['email', 'phone']);
  });
});

describe('redactSensitive', () => {
  it('replaces each span with a typed placeholder and keeps the rest', () => {
    expect(redactSensitive("numbers like '+44 7359228511' retained the space")).toBe(
      "numbers like '[redacted:phone]' retained the space",
    );
  });

  it('is a no-op on clean text', () => {
    const s = 'Live connector health with admin dashboard and daily alert';
    expect(redactSensitive(s)).toBe(s);
  });

  it('handles several matches in one string', () => {
    const out = redactSensitive('mail john@example.com or call 07359228511');
    expect(out).toBe('mail [redacted:email] or call [redacted:phone]');
  });
});

describe('redactDeep', () => {
  it('walks nested arrays and objects', () => {
    const input = {
      title: 'Fix JIDs',
      includes: ['handles +44 7359228511', 'strips spaces'],
      meta: { author: 'john@example.com', count: 3 },
    };
    expect(redactDeep(input)).toEqual({
      title: 'Fix JIDs',
      includes: ['handles [redacted:phone]', 'strips spaces'],
      meta: { author: '[redacted:email]', count: 3 },
    });
  });

  it('leaves non-strings untouched', () => {
    expect(redactDeep({ n: 5, b: true, z: null })).toEqual({ n: 5, b: true, z: null });
  });
});
