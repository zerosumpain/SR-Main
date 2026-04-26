import { describe, it, expect } from 'vitest';
import { lintDesignSystem } from '$lib/jkai/design-lint';

describe('lintDesignSystem', () => {
  it('flags hex colours outside tokens.css', () => {
    const r = lintDesignSystem({ 'app/style.css': 'body { background: #ff0000; }' });
    expect(r.findings.some((f) => f.rule === 'no-raw-hex')).toBe(true);
  });

  it('allows hex colours inside tokens.css', () => {
    const r = lintDesignSystem({ 'tokens.css': ':root { --bg: #ede4d4; }' });
    expect(r.findings).toEqual([]);
  });

  it('allows hex colours inside design-system/ paths', () => {
    const r = lintDesignSystem({ 'design-system/whatever.css': ':root { --bg: #ede4d4; }' });
    expect(r.findings).toEqual([]);
  });

  it('flags Tailwind utility class soup in HTML', () => {
    const r = lintDesignSystem({ 'a.html': '<div class="bg-red-500 text-white p-4">x</div>' });
    expect(r.findings.some((f) => f.rule === 'no-tailwind')).toBe(true);
  });

  it('flags raw font-family declarations', () => {
    const r = lintDesignSystem({ 'a.css': 'h1 { font-family: Inter, sans-serif; }' });
    expect(r.findings.some((f) => f.rule === 'no-raw-font')).toBe(true);
  });

  it('allows font-family using var(--font-*)', () => {
    const r = lintDesignSystem({ 'a.css': 'h1 { font-family: var(--font-display); }' });
    expect(r.findings).toEqual([]);
  });

  it('skips files outside the watch list (e.g. .py, .json)', () => {
    const r = lintDesignSystem({ 'data.json': '{"colour": "#ff0000"}', 'main.py': 'colour = "#ff0000"' });
    expect(r.findings).toEqual([]);
  });

  it('handles empty files dict', () => {
    expect(lintDesignSystem({}).findings).toEqual([]);
  });
});
