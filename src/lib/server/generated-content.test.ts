import { describe, expect, it } from 'vitest';
import {
  FIRST_PARTY_BUNDLE_CSP,
  GENERATED_CONTENT_CSP,
  safeGeneratedRequestHeaders,
  safeGeneratedResponseHeaders,
} from './generated-content';

describe('generated-content browser boundary', () => {
  it('uses an opaque sandbox and cannot submit forms', () => {
    expect(GENERATED_CONTENT_CSP).toContain('sandbox allow-scripts');
    expect(GENERATED_CONTENT_CSP).not.toContain('allow-same-origin');
    expect(GENERATED_CONTENT_CSP).toContain("form-action 'none'");
  });

  it('keeps a hand-built bundle first-party, with the rest of the hardening', () => {
    // No sandbox: an opaque origin costs a Vite bundle its own crossorigin
    // <script>/<link> (fetched without cookies -> 404 on a private project) and
    // turns every same-origin fetch('/api/...') into a cross-origin one.
    expect(FIRST_PARTY_BUNDLE_CSP).not.toContain('sandbox');
    expect(FIRST_PARTY_BUNDLE_CSP).toContain("object-src 'none'");
    expect(FIRST_PARTY_BUNDLE_CSP).toContain("base-uri 'self'");
    expect(FIRST_PARTY_BUNDLE_CSP).toContain("frame-ancestors 'self'");
    // The two policies differ by the sandbox directive and nothing else.
    expect(GENERATED_CONTENT_CSP).toBe(
      `sandbox allow-scripts allow-modals allow-downloads; ${FIRST_PARTY_BUNDLE_CSP}`,
    );
  });

  it('serves first-party HTML without the sandbox only when asked', () => {
    const html = () => new Headers({ 'content-type': 'text/html' });
    expect(safeGeneratedResponseHeaders(html()).get('content-security-policy')).toBe(
      GENERATED_CONTENT_CSP,
    );
    expect(
      safeGeneratedResponseHeaders(html(), { firstParty: false }).get('content-security-policy'),
    ).toBe(GENERATED_CONTENT_CSP);
    expect(
      safeGeneratedResponseHeaders(html(), { firstParty: true }).get('content-security-policy'),
    ).toBe(FIRST_PARTY_BUNDLE_CSP);
  });

  it('never puts a policy on a non-HTML response, first-party or not', () => {
    const js = new Headers({ 'content-type': 'application/javascript' });
    expect(
      safeGeneratedResponseHeaders(js, { firstParty: true }).get('content-security-policy'),
    ).toBeNull();
  });

  it('drops upstream credential and policy headers', () => {
    const source = new Headers({
      'content-type': 'text/html',
      'set-cookie': 'session=stolen',
      'content-security-policy': "default-src *",
      'access-control-allow-credentials': 'true',
    });
    const headers = safeGeneratedResponseHeaders(source);
    expect(headers.get('set-cookie')).toBeNull();
    expect(headers.get('access-control-allow-credentials')).toBeNull();
    expect(headers.get('content-security-policy')).toBe(GENERATED_CONTENT_CSP);
    expect(headers.get('permissions-policy')).toContain('geolocation=()');
  });

  it('never forwards application credentials to an agent process', () => {
    const headers = safeGeneratedRequestHeaders(new Headers({
      accept: 'text/html',
      cookie: 'auth=secret',
      authorization: 'Bearer secret',
      origin: 'https://strangeramblings.com',
      'x-forwarded-for': '127.0.0.1',
    }));
    expect(headers.get('accept')).toBe('text/html');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('origin')).toBeNull();
    expect(headers.get('x-forwarded-for')).toBeNull();
  });
});
