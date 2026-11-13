import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { STATIC_PROJECT_KEYS } from '$lib/projects/visibility';
import {
  BUNDLE_PROFILES,
  GENERATED_CONTENT_CSP,
  firstPartyBundleCsp,
  inlineScriptHashes,
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
    const csp = firstPartyBundleCsp('scs-earnings');
    expect(csp).not.toContain('sandbox');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it('gives a first-party bundle no third-party script host, inline script or eval by default', () => {
    // These pages run with the owner's session: a blanket https: or
    // 'unsafe-inline' would let an injected or CDN-served script run with it.
    for (const slug of [...STATIC_PROJECT_KEYS, 'not-a-profile']) {
      const csp = firstPartyBundleCsp(slug);
      expect(directive(csp, 'script-src')).not.toMatch(/https:|\*|'unsafe-inline'|blob:|data:/);
      for (const name of ['connect-src', 'img-src', 'font-src', 'style-src', 'default-src']) {
        expect(directive(csp, name)).not.toMatch(/(^| )(https:|wss:|\*)( |$)/);
      }
    }
    expect(directive(firstPartyBundleCsp('not-a-profile'), 'script-src')).toBe("script-src 'self'");
  });

  it('grants eval and extra origins only to the bundles whose profile asks', () => {
    expect(directive(firstPartyBundleCsp('scs-earnings'), 'script-src')).not.toContain('eval');
    expect(directive(firstPartyBundleCsp('archetype'), 'script-src')).toContain("'wasm-unsafe-eval'");
    expect(directive(firstPartyBundleCsp('archetype'), 'script-src')).not.toContain("'unsafe-eval'");
    expect(directive(firstPartyBundleCsp('marbler'), 'script-src')).toContain("'unsafe-eval'");
    expect(directive(firstPartyBundleCsp('archetype'), 'connect-src')).toBe(
      "connect-src 'self' https://openrouter.ai",
    );
    expect(directive(firstPartyBundleCsp('pulse'), 'font-src')).toBe(
      "font-src 'self' data: https://fonts.gstatic.com",
    );
    expect(directive(firstPartyBundleCsp('hometowns'), 'font-src')).toBe("font-src 'self' data:");
  });

  it('only profiles keys that are first-party bundles', () => {
    for (const slug of Object.keys(BUNDLE_PROFILES)) {
      expect(STATIC_PROJECT_KEYS as readonly string[]).toContain(slug);
    }
  });

  it("admits a document's own inline scripts and handlers by hash", () => {
    const body = '\n  boot();\n';
    const html = [
      `<script>${body}</script>`,
      '<script type="module" src="./assets/index.js"></script>',
      '<script type="application/json" id="data">{"a":1}</script>',
      '<script type="text/plain" id="blob"> onclick="evil()" </script>',
      `<form onsubmit="return false"><button onclick='go(&quot;x&quot;)'>Go</button></form>`,
    ].join('\n');
    expect(inlineScriptHashes(html)).toEqual([
      "'unsafe-hashes'",
      sha(body),
      sha('return false'),
      sha('go("x")'),
    ]);
    const script = directive(firstPartyBundleCsp('pulse', html), 'script-src');
    expect(script).toContain(sha(body));
    expect(script).not.toContain("'unsafe-inline'");
    // The parser normalises CRLF before the browser hashes the text.
    expect(inlineScriptHashes('<script>a();\r\nb();</script>')).toEqual([sha('a();\nb();')]);
    expect(inlineScriptHashes('<p>no scripts</p>')).toEqual([]);
  });

  it('serves first-party HTML without the sandbox only when asked', () => {
    const html = () => new Headers({ 'content-type': 'text/html' });
    expect(safeGeneratedResponseHeaders(html()).get('content-security-policy')).toBe(
      GENERATED_CONTENT_CSP,
    );
    expect(
      safeGeneratedResponseHeaders(html(), { firstParty: false }).get('content-security-policy'),
    ).toBe(GENERATED_CONTENT_CSP);
    const page = '<script>x()</script>';
    expect(
      safeGeneratedResponseHeaders(html(), { firstParty: true, slug: 'pulse', html: page }).get(
        'content-security-policy',
      ),
    ).toBe(firstPartyBundleCsp('pulse', page));
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

function directive(csp: string, name: string): string {
  return csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';
}

function sha(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}
