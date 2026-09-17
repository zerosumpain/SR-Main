import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { invokeLaneFor } from './invoke-auth';
import { env } from '$env/dynamic/private';

const STANDARD = 's'.repeat(48);
const DESTRUCTIVE = 'd'.repeat(48);

/**
 * The cast, and why it is not cosmetic — see `studio-auth.test.ts` for the full
 * story. SvelteKit types `$env/dynamic/private` from the variables present when
 * `svelte-kit sync` runs, so on a host that HAS these set they are required
 * `string` and `delete` is TS2790, while in CI they fall under the index
 * signature and are deletable. A change request died on exactly that mismatch.
 */
const mutableEnv = env as Record<string, string | undefined>;
const originalStandard = env.JKAI_INVOKE_TOKEN;
const originalDestructive = env.JKAI_INVOKE_DESTRUCTIVE_TOKEN;

function req(auth?: string): Request {
  return new Request('https://example.test/api/platform/tools/invoke', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  });
}

function restore(key: string, original: string | undefined) {
  if (original === undefined) delete mutableEnv[key];
  else mutableEnv[key] = original;
}

beforeEach(() => {
  mutableEnv.JKAI_INVOKE_TOKEN = STANDARD;
  delete mutableEnv.JKAI_INVOKE_DESTRUCTIVE_TOKEN;
});
afterEach(() => {
  restore('JKAI_INVOKE_TOKEN', originalStandard);
  restore('JKAI_INVOKE_DESTRUCTIVE_TOKEN', originalDestructive);
});

describe('invokeLaneFor', () => {
  it('opens the standard lane for the standard token', () => {
    expect(invokeLaneFor(req(`Bearer ${STANDARD}`))).toBe('standard');
  });

  /**
   * The decision this whole module exists for. After the split, Main trusts
   * SR-JKAI's ASSERTION that a human approved a destructive tool — it cannot
   * verify it, because it has no session for the person. Making that a second
   * credential turns "can an unattended process send mail as John" into a
   * deployment fact rather than a code path, and the default is no.
   */
  it('leaves the destructive lane shut when its token is unset', () => {
    expect(invokeLaneFor(req(`Bearer ${STANDARD}`))).toBe('standard');
    expect(invokeLaneFor(req(`Bearer ${DESTRUCTIVE}`))).toBe('none');
  });

  it('opens the destructive lane only for its own token', () => {
    mutableEnv.JKAI_INVOKE_DESTRUCTIVE_TOKEN = DESTRUCTIVE;
    expect(invokeLaneFor(req(`Bearer ${DESTRUCTIVE}`))).toBe('destructive');
    expect(invokeLaneFor(req(`Bearer ${STANDARD}`))).toBe('standard');
  });

  it('closes everything when no token is configured at all', () => {
    delete mutableEnv.JKAI_INVOKE_TOKEN;
    expect(invokeLaneFor(req(`Bearer ${STANDARD}`))).toBe('none');
    expect(invokeLaneFor(req(`Bearer ${DESTRUCTIVE}`))).toBe('none');
    expect(invokeLaneFor(req())).toBe('none');
  });

  it('refuses a request with no credential', () => {
    expect(invokeLaneFor(req())).toBe('none');
    expect(invokeLaneFor(req('Bearer '))).toBe('none');
  });

  it('refuses an empty configured token rather than matching an empty header', () => {
    mutableEnv.JKAI_INVOKE_TOKEN = '';
    expect(invokeLaneFor(req('Bearer '))).toBe('none');
    expect(invokeLaneFor(req())).toBe('none');
  });

  // A short secret is a configuration mistake, not a weak-but-usable one. The
  // token is the only control on this endpoint — it is deliberately not
  // loopback-gated, because on this VPS every request arrives through
  // cloudflared and appears to come from 127.0.0.1.
  it('refuses a token below the length floor even when it matches exactly', () => {
    mutableEnv.JKAI_INVOKE_TOKEN = 'tooshort';
    expect(invokeLaneFor(req('Bearer tooshort'))).toBe('none');
    mutableEnv.JKAI_INVOKE_DESTRUCTIVE_TOKEN = 'alsoshort';
    expect(invokeLaneFor(req('Bearer alsoshort'))).toBe('none');
  });

  it('rejects a wrong token of the same length, and a prefix of a real one', () => {
    expect(invokeLaneFor(req(`Bearer ${'x'.repeat(48)}`))).toBe('none');
    expect(invokeLaneFor(req(`Bearer ${STANDARD.slice(0, 40)}`))).toBe('none');
  });

  it('requires the Bearer scheme, spelled that way', () => {
    expect(invokeLaneFor(req(STANDARD))).toBe('none');
    expect(invokeLaneFor(req(`Token ${STANDARD}`))).toBe('none');
    expect(invokeLaneFor(req(`bearer ${STANDARD}`))).toBe('none');
  });

  // Both variables set to the same string is a misconfiguration; it must still
  // be deterministic, and the answer is the wider lane rather than whichever
  // comparison happened to run first.
  it('gives the wider lane when both variables hold the same token', () => {
    mutableEnv.JKAI_INVOKE_DESTRUCTIVE_TOKEN = STANDARD;
    expect(invokeLaneFor(req(`Bearer ${STANDARD}`))).toBe('destructive');
  });

  // The config footgun that fails closed: a stray space in the stored value is
  // not stripped, while the platform normalises the header. Annoying to debug,
  // safe by default — the right way round.
  it('fails closed when the configured token itself has stray whitespace', () => {
    mutableEnv.JKAI_INVOKE_TOKEN = `${STANDARD} `;
    expect(invokeLaneFor(req(`Bearer ${STANDARD}`))).toBe('none');
  });
});
