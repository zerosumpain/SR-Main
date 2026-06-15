import { describe, it, expect } from 'vitest';
import { isSafeFetchUrl, extractPreviewImage, faviconFor } from './og-image';

// ---------------------------------------------------------------------------
// isSafeFetchUrl
// ---------------------------------------------------------------------------

describe('isSafeFetchUrl', () => {
  it('accepts a normal public https URL', () => {
    expect(isSafeFetchUrl('https://example.com/page')).toBe(true);
  });

  it('accepts a normal public http URL', () => {
    expect(isSafeFetchUrl('http://example.com/')).toBe(true);
  });

  it('rejects localhost by hostname', () => {
    expect(isSafeFetchUrl('http://localhost:3000/')).toBe(false);
  });

  it('rejects *.local hostnames', () => {
    expect(isSafeFetchUrl('http://myapp.local/')).toBe(false);
    expect(isSafeFetchUrl('http://printer.local/')).toBe(false);
  });

  it('rejects 127.x.x.x (loopback)', () => {
    expect(isSafeFetchUrl('http://127.0.0.1/')).toBe(false);
    expect(isSafeFetchUrl('http://127.1.2.3/')).toBe(false);
  });

  it('rejects 10.x.x.x (private class A)', () => {
    expect(isSafeFetchUrl('http://10.0.0.1/')).toBe(false);
    expect(isSafeFetchUrl('http://10.255.255.255/')).toBe(false);
  });

  it('rejects 192.168.x.x (private class C)', () => {
    expect(isSafeFetchUrl('http://192.168.1.1/')).toBe(false);
  });

  it('rejects 172.16.x.x–172.31.x.x (private class B)', () => {
    expect(isSafeFetchUrl('http://172.16.0.1/')).toBe(false);
    expect(isSafeFetchUrl('http://172.31.255.255/')).toBe(false);
    // Just outside the range — 172.15 and 172.32 are public
    expect(isSafeFetchUrl('http://172.15.0.1/')).toBe(true);
    expect(isSafeFetchUrl('http://172.32.0.1/')).toBe(true);
  });

  it('rejects 169.254.x.x (link-local)', () => {
    expect(isSafeFetchUrl('http://169.254.1.1/')).toBe(false);
  });

  it('rejects IPv6 loopback ::1', () => {
    expect(isSafeFetchUrl('http://[::1]/')).toBe(false);
  });

  // SSRF: trailing-dot host normalization
  it('rejects localhost. (trailing dot resolves to loopback)', () => {
    expect(isSafeFetchUrl('http://localhost./')).toBe(false);
  });

  it('rejects 127.0.0.1. (trailing dot on loopback IPv4)', () => {
    expect(isSafeFetchUrl('http://127.0.0.1./')).toBe(false);
  });

  // SSRF: IPv6 private ranges
  it('rejects IPv6 ULA fc00::/7 (fc prefix)', () => {
    expect(isSafeFetchUrl('http://[fc00::1]/')).toBe(false);
  });

  it('rejects IPv6 ULA fc00::/7 (fd prefix)', () => {
    expect(isSafeFetchUrl('http://[fd12:3456::1]/')).toBe(false);
  });

  it('rejects IPv6 link-local fe80::/10', () => {
    expect(isSafeFetchUrl('http://[fe80::1]/')).toBe(false);
  });

  it('accepts public IPv6 global unicast (2000::/3)', () => {
    expect(isSafeFetchUrl('http://[2606:4700::1]/')).toBe(true);
  });

  it('rejects 0.0.0.0', () => {
    expect(isSafeFetchUrl('http://0.0.0.0/')).toBe(false);
  });

  it('rejects file:// scheme', () => {
    expect(isSafeFetchUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects ftp:// scheme', () => {
    expect(isSafeFetchUrl('ftp://example.com/file')).toBe(false);
  });

  it('rejects garbage / non-URL strings', () => {
    expect(isSafeFetchUrl('')).toBe(false);
    expect(isSafeFetchUrl('not-a-url')).toBe(false);
    expect(isSafeFetchUrl('javascript:alert(1)')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractPreviewImage
// ---------------------------------------------------------------------------

const BASE = 'https://example.com';

describe('extractPreviewImage', () => {
  it('returns og:image absolute URL', () => {
    const html = `<meta property="og:image" content="https://cdn.example.com/img.jpg">`;
    expect(extractPreviewImage(html, BASE)).toBe('https://cdn.example.com/img.jpg');
  });

  it('resolves og:image relative URL against baseUrl', () => {
    const html = `<meta property="og:image" content="/images/hero.png">`;
    expect(extractPreviewImage(html, BASE)).toBe('https://example.com/images/hero.png');
  });

  it('falls back to twitter:image when no og:image', () => {
    const html = `<meta name="twitter:image" content="https://cdn.example.com/tw.jpg">`;
    expect(extractPreviewImage(html, BASE)).toBe('https://cdn.example.com/tw.jpg');
  });

  it('falls back to twitter:image:src variant', () => {
    const html = `<meta name="twitter:image:src" content="https://cdn.example.com/tw2.jpg">`;
    expect(extractPreviewImage(html, BASE)).toBe('https://cdn.example.com/tw2.jpg');
  });

  it('falls back to link rel="image_src"', () => {
    const html = `<link rel="image_src" href="https://cdn.example.com/ls.jpg">`;
    expect(extractPreviewImage(html, BASE)).toBe('https://cdn.example.com/ls.jpg');
  });

  it('returns null when no preview image found', () => {
    const html = `<html><head><title>Nothing here</title></head></html>`;
    expect(extractPreviewImage(html, BASE)).toBeNull();
  });

  it('tolerates content attribute before property attribute', () => {
    const html = `<meta content="https://cdn.example.com/rev.jpg" property="og:image">`;
    expect(extractPreviewImage(html, BASE)).toBe('https://cdn.example.com/rev.jpg');
  });

  it('tolerates single quotes', () => {
    const html = `<meta property='og:image' content='https://cdn.example.com/sq.jpg'>`;
    expect(extractPreviewImage(html, BASE)).toBe('https://cdn.example.com/sq.jpg');
  });

  it('og:image takes priority over twitter:image', () => {
    const html = `
      <meta name="twitter:image" content="https://cdn.example.com/tw.jpg">
      <meta property="og:image" content="https://cdn.example.com/og.jpg">
    `;
    expect(extractPreviewImage(html, BASE)).toBe('https://cdn.example.com/og.jpg');
  });

  it('twitter:image takes priority over link rel="image_src"', () => {
    const html = `
      <link rel="image_src" href="https://cdn.example.com/ls.jpg">
      <meta name="twitter:image" content="https://cdn.example.com/tw.jpg">
    `;
    expect(extractPreviewImage(html, BASE)).toBe('https://cdn.example.com/tw.jpg');
  });

  it('returns null for relative URL that resolves to an invalid base', () => {
    // If baseUrl is invalid, new URL() throws — should return null
    const html = `<meta property="og:image" content="/img.jpg">`;
    expect(extractPreviewImage(html, 'not-a-url')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// faviconFor
// ---------------------------------------------------------------------------

describe('faviconFor', () => {
  it('builds the correct Google favicon URL', () => {
    expect(faviconFor('https://example.com/some/path')).toBe(
      'https://www.google.com/s2/favicons?domain=example.com&sz=128',
    );
  });

  it('preserves hostname including www', () => {
    expect(faviconFor('https://www.bbc.co.uk/news')).toBe(
      'https://www.google.com/s2/favicons?domain=www.bbc.co.uk&sz=128',
    );
  });
});
