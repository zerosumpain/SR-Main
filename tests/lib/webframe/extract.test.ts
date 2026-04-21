import { describe, it, expect } from 'vitest';
import { extractArticle } from '$lib/webframe/extract';

describe('extractArticle', () => {
  it('extracts title and body text from article HTML', () => {
    const html = `<html><head><title>Test</title></head><body><article><h1>Hello</h1><p>This is the first paragraph with enough substance for Readability to treat it as article content that matters.</p><p>Another paragraph with more content so Readability has a meaningful scoring target.</p></article></body></html>`;
    const out = extractArticle(html, 'https://example.com/a');
    expect(out.text).toMatch(/first paragraph/);
    expect(out.title).toMatch(/Hello|Test/);
  });

  it('returns empty text when input is junk', () => {
    const out = extractArticle('<html></html>', 'https://a.com');
    expect(out.text).toBe('');
  });

  it('does not throw on invalid HTML', () => {
    const out = extractArticle('<<not-html', 'https://a.com');
    expect(out.text).toBeDefined();
  });
});
