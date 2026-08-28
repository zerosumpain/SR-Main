// Security tests for the API secret registry's binding + redaction primitives.
//
// These lock the single invariant that makes "jkai can use a key it cannot see"
// safe: a registry secret is only ever attached to a request whose host (and
// optionally path) the OWNER allowed. Catalogue entries are LLM-writable, so a
// prompt-injected model will always be able to point an entry at its own host —
// these tests are what stop that from moving a credential.

import { describe, it, expect } from 'vitest';

// registry.ts imports $lib/db (postgres) at module load — stub it so the pure
// helpers can be imported without a database.
import { vi } from 'vitest';
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/secrets/crypto', () => ({
  encryptPayload: (s: string) => `enc:${s}`,
  decryptPayload: (s: string) => s.replace(/^enc:/, ''),
}));

import {
  hostMatchesPattern,
  hostAllowed,
  pathAllowed,
  redactSecrets,
  normaliseHandle,
  composeInjection,
  SecretError,
} from './registry';

describe('hostMatchesPattern — exfiltration defence', () => {
  it('matches an exact host, case- and trailing-dot-insensitively', () => {
    expect(hostMatchesPattern('openrouter.ai', 'openrouter.ai')).toBe(true);
    expect(hostMatchesPattern('OpenRouter.AI', 'openrouter.ai')).toBe(true);
    expect(hostMatchesPattern('openrouter.ai.', 'openrouter.ai')).toBe(true);
    expect(hostMatchesPattern('openrouter.ai', 'OpenRouter.ai.')).toBe(true);
  });

  it('rejects an attacker host that merely contains the allowed host', () => {
    expect(hostMatchesPattern('openrouter.ai.evil.example', 'openrouter.ai')).toBe(false);
    expect(hostMatchesPattern('notopenrouter.ai', 'openrouter.ai')).toBe(false);
    expect(hostMatchesPattern('openrouter.ai.evil', 'openrouter.ai')).toBe(false);
    expect(hostMatchesPattern('evil-openrouter.ai', 'openrouter.ai')).toBe(false);
  });

  it('rejects a sub-domain unless the owner explicitly wildcarded', () => {
    expect(hostMatchesPattern('api.openrouter.ai', 'openrouter.ai')).toBe(false);
    expect(hostMatchesPattern('api.openrouter.ai', '*.openrouter.ai')).toBe(true);
  });

  it('wildcards match only at a dot boundary, and never the apex', () => {
    expect(hostMatchesPattern('evilopenrouter.ai', '*.openrouter.ai')).toBe(false);
    expect(hostMatchesPattern('openrouter.ai', '*.openrouter.ai')).toBe(false);
    expect(hostMatchesPattern('a.b.openrouter.ai', '*.openrouter.ai')).toBe(true);
  });

  it('never accepts a bare wildcard — a secret cannot be host-unbound', () => {
    expect(hostMatchesPattern('anything.example', '*')).toBe(false);
    expect(hostMatchesPattern('anything.example', '')).toBe(false);
  });

  it('rejects a unicode homoglyph host (punycode makes them distinct)', () => {
    // 'оpenrouter.ai' with a Cyrillic о — new URL() punycodes it to xn--...
    const puny = new URL('https://оpenrouter.ai/x').hostname;
    expect(puny).not.toBe('openrouter.ai');
    expect(hostMatchesPattern(puny, 'openrouter.ai')).toBe(false);
  });

  it('hostAllowed requires at least one matching pattern', () => {
    expect(hostAllowed('openrouter.ai', [])).toBe(false);
    expect(hostAllowed('openrouter.ai', ['example.com', 'openrouter.ai'])).toBe(true);
    expect(hostAllowed('evil.example', ['example.com', 'openrouter.ai'])).toBe(false);
  });
});

describe('pathAllowed — least-privilege narrowing', () => {
  it('allows any path when no prefixes are set', () => {
    expect(pathAllowed('/anything', [])).toBe(true);
  });

  it('matches the prefix exactly or at a segment boundary', () => {
    expect(pathAllowed('/api/v1/credits', ['/api/v1/credits'])).toBe(true);
    expect(pathAllowed('/api/v1/credits/detail', ['/api/v1/credits'])).toBe(true);
  });

  it('does not let a sibling path masquerade as the allowed prefix', () => {
    expect(pathAllowed('/api/v1/creditsomething', ['/api/v1/credits'])).toBe(false);
    expect(pathAllowed('/api/v1/chat/completions', ['/api/v1/credits'])).toBe(false);
  });
});

describe('redactSecrets', () => {
  const KEY = 'sk-or-v1-abcdef0123456789';

  it('scrubs the value out of strings, nested objects and arrays', () => {
    const out = redactSecrets(
      { url: `https://x.example/?key=${KEY}`, rows: [{ echoed: KEY }], note: 'fine' },
      [KEY],
    );
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(out.note).toBe('fine');
    expect(out.rows[0].echoed).toBe('[redacted]');
  });

  it('scrubs a percent-encoded copy (query-injected keys in a URL)', () => {
    const withSlash = 'sk-or/v1+abcdef0123456789';
    const url = `https://x.example/?key=${encodeURIComponent(withSlash)}`;
    expect(redactSecrets({ url }, [withSlash]).url).not.toContain(encodeURIComponent(withSlash));
  });

  it('scrubs object KEYS as well as values', () => {
    const out = redactSecrets({ [KEY]: 'v' }, [KEY]) as Record<string, string>;
    expect(Object.keys(out)).toEqual(['[redacted]']);
  });

  it('ignores implausibly short needles rather than shredding the payload', () => {
    expect(redactSecrets({ text: 'a bad cat' }, ['a']).text).toBe('a bad cat');
  });

  it('is a no-op with no needles', () => {
    expect(redactSecrets({ a: 1, b: 'x' }, [])).toEqual({ a: 1, b: 'x' });
  });
});

describe('composeInjection — using a credential, including a multi-field one', () => {
  const SET = JSON.stringify({
    consumer_key: 'ck-live-9999',
    consumer_secret: 'cs-live-8888',
    group_id: 'my-group',
    username: 'user-1',
    password: 'p4ssw0rd-secret',
  });

  it('sends a whole single value as a bearer token', () => {
    const out = composeInjection('h', { kind: 'bearer' }, 'sk-123');
    expect(out.headers.Authorization).toBe('Bearer sk-123');
    expect(out.plaintexts).toEqual(['sk-123']);
  });

  it('sends only the named field of a set, never the whole blob', () => {
    const out = composeInjection('h', { kind: 'header', name: 'x-apikey', field: 'consumer_key' }, SET);
    expect(out.headers['x-apikey']).toBe('ck-live-9999');
    // The rest of the set stays put — this is the failure that made
    // `{kind:'none'}` necessary before there was a field selector.
    expect(JSON.stringify(out)).not.toContain('cs-live-8888');
    expect(out.plaintexts).toEqual(['ck-live-9999']);
  });

  it('puts a named field in the query string when asked', () => {
    const out = composeInjection('h', { kind: 'query', name: 'key', field: 'consumer_secret' }, SET);
    expect(out.query.key).toBe('cs-live-8888');
  });

  it('composes Basic and lists every scrubbable form of it', () => {
    const out = composeInjection('h', { kind: 'basic' }, SET);
    expect(out.headers.Authorization).toBe(`Basic ${Buffer.from('user-1:p4ssw0rd-secret').toString('base64')}`);
    // The password, the pair and the base64 — a response echoing any of them
    // must not slip past redactSecrets.
    expect(out.plaintexts).toContain('p4ssw0rd-secret');
    expect(out.plaintexts).toContain('user-1:p4ssw0rd-secret');
    expect(out.plaintexts.some((p) => p === Buffer.from('user-1:p4ssw0rd-secret').toString('base64'))).toBe(true);
  });

  it('reads a Basic pair from the fields the owner named', () => {
    const out = composeInjection(
      'h',
      { kind: 'basic', usernameField: 'consumer_key', passwordField: 'consumer_secret' },
      SET,
    );
    expect(out.headers.Authorization).toBe(`Basic ${Buffer.from('ck-live-9999:cs-live-8888').toString('base64')}`);
  });

  it('keeps sending the whole value when no field is named — the original behaviour', () => {
    const out = composeInjection('h', { kind: 'header', name: 'x-apikey' }, 'plain-key');
    expect(out.headers['x-apikey']).toBe('plain-key');
  });

  it('refuses a store-only row rather than inventing a place to put it', () => {
    expect(() => composeInjection('h', { kind: 'none' }, SET)).toThrow(SecretError);
  });

  it('says so plainly when a set is expected but a single value is stored', () => {
    expect(() => composeInjection('h', { kind: 'basic' }, 'just-a-key')).toThrow(/not a set|credential set/);
  });

  it('names the missing field and quotes no other part of the set', () => {
    try {
      composeInjection('h', { kind: 'header', name: 'x', field: 'nope' }, SET);
      throw new Error('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('nope');
      expect(msg).not.toContain('cs-live-8888');
      expect(msg).not.toContain('p4ssw0rd-secret');
    }
  });

  it('treats a blank field as missing rather than authenticating with nothing', () => {
    expect(() =>
      composeInjection('h', { kind: 'header', name: 'x', field: 'consumer_key' }, JSON.stringify({ consumer_key: '  ' })),
    ).toThrow(/has no "consumer_key"/);
  });
});

describe('normaliseHandle', () => {
  it('slugifies and bounds the handle so it cannot collide by whitespace/case', () => {
    expect(normaliseHandle('  OpenRouter ')).toBe('openrouter');
    expect(normaliseHandle('open router!!')).toBe('open-router');
    expect(normaliseHandle('-x-')).toBe('x');
  });
});
