import { describe, it, expect } from 'vitest';
import { parseFramePermissiveness } from '$lib/webframe/probe-parse';

describe('parseFramePermissiveness', () => {
  it('returns canFrame=false when X-Frame-Options is DENY', () => {
    const r = parseFramePermissiveness({ 'x-frame-options': 'DENY' }, 'https://a.com');
    expect(r.canFrame).toBe(false);
    expect(r.reason).toMatch(/DENY/);
  });

  it('returns canFrame=false when X-Frame-Options is SAMEORIGIN', () => {
    const r = parseFramePermissiveness({ 'x-frame-options': 'SAMEORIGIN' }, 'https://a.com');
    expect(r.canFrame).toBe(false);
  });

  it('handles lowercase header names only (normalized by caller)', () => {
    const r = parseFramePermissiveness({ 'x-frame-options': 'deny' }, 'https://a.com');
    expect(r.canFrame).toBe(false);
  });

  it("returns canFrame=false when CSP frame-ancestors excludes ours (no wildcard, no self)", () => {
    const r = parseFramePermissiveness(
      { 'content-security-policy': "frame-ancestors https://other.com" },
      'https://a.com'
    );
    expect(r.canFrame).toBe(false);
  });

  it("returns canFrame=true when CSP frame-ancestors includes *", () => {
    const r = parseFramePermissiveness(
      { 'content-security-policy': "frame-ancestors *" },
      'https://a.com'
    );
    expect(r.canFrame).toBe(true);
  });

  it("returns canFrame=true when CSP frame-ancestors includes 'self' and origin matches", () => {
    const r = parseFramePermissiveness(
      { 'content-security-policy': "frame-ancestors 'self' https://a.com" },
      'https://a.com'
    );
    expect(r.canFrame).toBe(true);
  });

  it('returns canFrame=true when headers are silent', () => {
    expect(parseFramePermissiveness({}, 'https://a.com').canFrame).toBe(true);
  });

  it('is case-insensitive on X-Frame-Options value', () => {
    const r = parseFramePermissiveness({ 'x-frame-options': 'Deny' }, 'https://a.com');
    expect(r.canFrame).toBe(false);
  });
});
