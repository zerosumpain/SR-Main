import { describe, it, expect } from 'vitest';
import { classifyLink, isReplayablePath, redactPayload, redactUrl } from './umami';
import { analyticsIdentity } from '$lib/server/analytics-identity';

describe('redactUrl', () => {
  it('replaces capability tokens and UUIDs in the path, keeping its shape', () => {
    expect(redactUrl('https://strangeramblings.com/install/Zk3x9QpLm2Vb7RtY0aWc4d')).toBe(
      'https://strangeramblings.com/install/:token',
    );
    expect(redactUrl('/trips/ac7cde28-7d32-4456-95bc-01dffa53078f#details')).toBe('/trips/:id#details');
    expect(redactUrl('/policy-analysis/shared/0a1b2c3d4e5f60718293a4b5c6d7e8f9')).toBe(
      '/policy-analysis/shared/:token',
    );
  });

  it('keeps readable slugs, numeric ids and anchors', () => {
    expect(redactUrl('/blog/let-s-build-a-bigger-bucket-for-the-long-run#h-intro')).toBe(
      '/blog/let-s-build-a-bigger-bucket-for-the-long-run#h-intro',
    );
    expect(redactUrl('/admin/content/blog/14')).toBe('/admin/content/blog/14');
    expect(redactUrl('/projects#pn-casebook')).toBe('/projects#pn-casebook');
  });

  it('redacts secret query values and keyed hash state, keeping harmless keys', () => {
    expect(redactUrl('https://strangeramblings.com/admin/reset-password?token=abc123&from=mail')).toBe(
      'https://strangeramblings.com/admin/reset-password?token=:redacted&from=mail',
    );
    expect(redactUrl('/projects/policy-engine#s=eyJhbGciOi')).toBe('/projects/policy-engine#s=:redacted');
    expect(redactUrl('/home/people?section=places&view=map')).toBe('/home/people?section=places&view=map');
  });

  it('passes empty values through and redacts a payload referrer too', () => {
    expect(redactUrl('')).toBe('');
    expect(redactUrl(undefined)).toBeUndefined();
    const out = redactPayload({ url: '/blog/preview/Zk3x9QpLm2Vb7RtY0aWc4d', referrer: '/login?callbackUrl=%2Fx&code=9', title: 't' });
    expect(out).toEqual({ url: '/blog/preview/:token', referrer: '/login?callbackUrl=%2Fx&code=:redacted', title: 't' });
  });
});

describe('classifyLink', () => {
  const host = 'strangeramblings.com';
  it('reports outbound links by host, without query strings', () => {
    expect(classifyLink('https://www.linkedin.com/in/someone?trk=abc', host, false)).toEqual({
      event: 'outbound-link',
      data: { host: 'www.linkedin.com', url: 'https://www.linkedin.com/in/someone' },
    });
  });
  it('treats www. as the same site and ordinary links as navigation', () => {
    expect(classifyLink('https://www.strangeramblings.com/blog', host, false)).toBeNull();
    expect(classifyLink('/projects', host, false)).toBeNull();
  });
  it('reports downloads, and contact links without the address', () => {
    expect(classifyLink('/files/report.PDF', host, false)).toEqual({
      event: 'download',
      data: { file: '/files/report.PDF', ext: 'pdf' },
    });
    expect(classifyLink('/whatever', host, true)?.event).toBe('download');
    expect(classifyLink('mailto:me@example.com', host, false)).toEqual({
      event: 'outbound-link',
      data: { host: 'mailto', url: 'mailto:' },
    });
    expect(classifyLink('javascript:void(0)', host, false)).toBeNull();
  });
});

describe('isReplayablePath', () => {
  it('allows public pages and published posts only', () => {
    for (const p of ['/', '/blog', '/blog/a-post', '/projects', '/welcome', '/privacy']) {
      expect(isReplayablePath(p)).toBe(true);
    }
    for (const p of ['/blog/preview/abc', '/trips/x', '/install/x', '/projects/policy-engine', '/admin', '/home/people']) {
      expect(isReplayablePath(p)).toBe(false);
    }
  });
});

describe('analyticsIdentity', () => {
  it('never identifies an anonymous visitor and never sends an email', () => {
    expect(analyticsIdentity({ kind: 'anonymous' }, 's')).toBeNull();
    expect(analyticsIdentity({ kind: 'owner' }, 's')).toEqual({ id: 'owner', role: 'owner' });
    const guest = analyticsIdentity({ kind: 'guest', email: 'Jane@Example.com' }, 's');
    expect(guest?.role).toBe('guest');
    expect(guest?.id).toMatch(/^guest-[0-9a-f]{16}$/);
    expect(JSON.stringify(guest)).not.toContain('jane');
    // Stable per account, case-insensitive, and keyed: another secret, another id.
    expect(analyticsIdentity({ kind: 'guest', email: 'jane@example.com' }, 's')).toEqual(guest);
    expect(analyticsIdentity({ kind: 'guest', email: 'jane@example.com' }, 'other')?.id).not.toBe(guest?.id);
  });
  it('falls back to the bare role without a secret', () => {
    expect(analyticsIdentity({ kind: 'guest', email: 'a@b.c' }, undefined)).toEqual({ id: 'guest', role: 'guest' });
  });
});
