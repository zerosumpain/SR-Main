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

  it('flags Tailwind with variant prefixes and the ! important marker', () => {
    for (const cls of ['sm:flex', 'hover:bg-red-500', '!p-4', 'md:text-lg', 'grid', 'flex']) {
      const r = lintDesignSystem({ 'a.html': `<div class="${cls}">x</div>` });
      expect(r.findings.some((f) => f.rule === 'no-tailwind'), cls).toBe(true);
    }
  });

  // The prompt mandates `.nm-text-input` by name, and the substring form of
  // this rule rejected it — an instruction the agent cannot obey and a
  // finding it cannot fix, which is exactly what aborts a build as
  // design_lint_loop. Tailwind utilities are matched at the start of a class
  // token, never as a substring inside a longer kebab-case name.
  it('does not flag design-system classes that merely contain a utility substring', () => {
    for (const cls of [
      'nm-text-input',
      'nm-save-btn',
      'chapter-grid',
      'cellgrid',
      'sidebar-flex',
      'card-bg-dark',
      'nm-sec',
      'page-hdr',
    ]) {
      const r = lintDesignSystem({ 'a.html': `<div class="${cls}">x</div>` });
      expect(r.findings.some((f) => f.rule === 'no-tailwind'), cls).toBe(false);
    }
  });

  it('still flags a real utility sitting alongside design-system classes', () => {
    const r = lintDesignSystem({ 'a.html': '<div class="nm-text-input p-4">x</div>' });
    expect(r.findings.some((f) => f.rule === 'no-tailwind')).toBe(true);
  });

  it('handles single-quoted class attributes', () => {
    const r = lintDesignSystem({ 'a.html': "<div class='bg-red-500'>x</div>" });
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
