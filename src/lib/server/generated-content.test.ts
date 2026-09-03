import { describe, expect, it } from 'vitest';
import {
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
