import { describe, it, expect } from 'vitest';
import { normaliseCardFields, resolveProjectCard } from './project-card';

describe('normaliseCardFields', () => {
  it('leaves absent keys alone so a bare Publish cannot wipe a curated card', () => {
    const r = normaliseCardFields({ slug: 'my-thing' });
    expect(r).toEqual({ ok: true, fields: {} });
  });

  it('treats an empty string as "clear this back to the fallback"', () => {
    const r = normaliseCardFields({ cardBlurb: '   ' });
    expect(r.ok && r.fields.cardBlurb).toBe(null);
  });

  it('trims and keeps real values', () => {
    const r = normaliseCardFields({ cardTitle: '  A Proper Title  ', cardTag: 'Interactive' });
    expect(r.ok && r.fields).toEqual({ cardTitle: 'A Proper Title', cardTag: 'Interactive' });
  });

  it('rejects over-long copy with the actual number, not a generic error', () => {
    const r = normaliseCardFields({ cardBlurb: 'x'.repeat(401) });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toBe('blurb is 401 characters — the limit is 400');
  });

  it('rejects a non-string rather than coercing it', () => {
    const r = normaliseCardFields({ cardTitle: 42 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('must be text');
  });

  it('accepts an explicit null', () => {
    const r = normaliseCardFields({ cardTag: null });
    expect(r.ok && r.fields.cardTag).toBe(null);
  });
});

describe('resolveProjectCard', () => {
  const build = { title: 'Calculator', prompt: 'build me a graphing calculator that plots x^2' };

  it('reproduces the pre-promotion card when nothing is curated', () => {
    const c = resolveProjectCard(build);
    expect(c.heading).toBe('Calculator');
    expect(c.blurb).toBe(build.prompt);
    expect(c.tag).toBe(null);
    expect(c.curated).toBe(false);
  });

  it('falls back to the first 40 characters of the prompt with no title at all', () => {
    const c = resolveProjectCard({ title: null, prompt: build.prompt });
    expect(c.heading).toBe('build me a graphing calculator that plot');
  });

  it('prefers the curated copy', () => {
    const c = resolveProjectCard({
      ...build,
      cardTitle: 'Graphing Calculator',
      cardBlurb: 'Plot any function, read off the roots.',
      cardTag: 'Interactive · Maths',
    });
    expect(c.heading).toBe('Graphing Calculator');
    expect(c.blurb).toBe('Plot any function, read off the roots.');
    expect(c.tag).toBe('Interactive · Maths');
    expect(c.curated).toBe(true);
  });

  it('does not count a tag alone as curated — the prompt is still on show', () => {
    expect(resolveProjectCard({ ...build, cardTag: 'Interactive' }).curated).toBe(false);
  });
});
