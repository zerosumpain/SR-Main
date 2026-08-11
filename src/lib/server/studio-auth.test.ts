import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hasStudioServiceToken } from './studio-auth';
import { env } from '$env/dynamic/private';

const GOOD = 'k'.repeat(48);
const original = env.STUDIO_SERVICE_TOKEN;

/**
 * `delete env.STUDIO_SERVICE_TOKEN` needs this cast, and the reason is not
 * cosmetic — deleting it broke every autonomous build on the VPS for a day.
 *
 * SvelteKit generates the type of `$env/dynamic/private` from the variables
 * present when `svelte-kit sync` runs. In CI the variable does not exist, so it
 * falls under the index signature and is `string | undefined` — deletable. On
 * the VPS it IS set, so the generated declaration is a required `string`, and
 * `delete` on a non-optional property is TS2790. The type of this file
 * therefore depends on the secrets the host happens to hold.
 *
 * That is how change request #204 died: the agent wrote its feature, ran
 * `npm run gate` in a workspace on the VPS, and was failed by two type errors
 * in this file — which it had never touched and which CI had passed minutes
 * earlier. Keep the cast; it is the only thing making the two agree.
 */
const mutableEnv = env as Record<string, string | undefined>;

function req(auth?: string): Request {
  return new Request('https://example.test/api/jkai/studio', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  env.STUDIO_SERVICE_TOKEN = GOOD;
});
afterEach(() => {
  if (original === undefined) delete mutableEnv.STUDIO_SERVICE_TOKEN;
  else env.STUDIO_SERVICE_TOKEN = original;
});

describe('hasStudioServiceToken', () => {
  it('accepts the configured token', () => {
    expect(hasStudioServiceToken(req(`Bearer ${GOOD}`))).toBe(true);
  });

  // The failure that matters. An unset variable must mean the door does not
  // exist, not that any request opens it. This repo's worst incident was an
  // auth flag that defaulted the wrong way and reached production.
  it('refuses everything when the token is unset', () => {
    delete mutableEnv.STUDIO_SERVICE_TOKEN;
    expect(hasStudioServiceToken(req(`Bearer ${GOOD}`))).toBe(false);
    expect(hasStudioServiceToken(req('Bearer '))).toBe(false);
    expect(hasStudioServiceToken(req())).toBe(false);
  });

  it('refuses an empty-string token rather than matching an empty header', () => {
    env.STUDIO_SERVICE_TOKEN = '';
    expect(hasStudioServiceToken(req('Bearer '))).toBe(false);
    expect(hasStudioServiceToken(req())).toBe(false);
  });

  // A short secret is a configuration mistake, not a weak-but-usable one — a
  // 4-character token would be brute-forceable through the 3/hour limit given
  // time, so refuse to honour it at all.
  it('refuses a token below the length floor even if it matches exactly', () => {
    env.STUDIO_SERVICE_TOKEN = 'tooshort';
    expect(hasStudioServiceToken(req('Bearer tooshort'))).toBe(false);
  });

  it('rejects a wrong token of the same length', () => {
    expect(hasStudioServiceToken(req(`Bearer ${'x'.repeat(48)}`))).toBe(false);
  });

  it('rejects a prefix of the real token', () => {
    expect(hasStudioServiceToken(req(`Bearer ${GOOD.slice(0, 40)}`))).toBe(false);
  });

  it('requires the Bearer scheme, not a bare token', () => {
    expect(hasStudioServiceToken(req(GOOD))).toBe(false);
    expect(hasStudioServiceToken(req(`Token ${GOOD}`))).toBe(false);
    // Case matters: the header value is compared literally after "Bearer ".
    expect(hasStudioServiceToken(req(`bearer ${GOOD}`))).toBe(false);
  });

  // HTTP header values are whitespace-normalised by the Request constructor, so
  // padding never reaches the comparison — asserted here so nobody later "fixes"
  // it by adding a .trim(), which WOULD widen what counts as a match.
  it('is unaffected by header padding, because the platform strips it', () => {
    expect(hasStudioServiceToken(req(`Bearer ${GOOD} `))).toBe(true);
  });

  // The corresponding config footgun: a stray space in the .env value does NOT
  // get stripped, so the stored secret and the sent one differ and every call
  // fails closed. Annoying to debug, safe by default — which is the right way
  // round.
  it('fails closed when the configured token itself has stray whitespace', () => {
    env.STUDIO_SERVICE_TOKEN = `${GOOD} `;
    expect(hasStudioServiceToken(req(`Bearer ${GOOD}`))).toBe(false);
  });
});
