import { describe, expect, it } from 'vitest';
import { renderProse } from './prose';

describe('renderProse', () => {
  it('escapes HTML before anything else', () => {
    expect(renderProse('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('renders bold, italic and underline without collisions', () => {
    const html = renderProse('**bold** and *italic* and __under__');
    expect(html).toContain('<b>bold</b>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<u>under</u>');
  });

  it('renders # … #### heading lines as h1–h4', () => {
    const html = renderProse('# Big\nbody line\n\n#### KICKER');
    expect(html).toContain('<h1>Big</h1>');
    expect(html).toContain('<p>body line</p>');
    expect(html).toContain('<h4>KICKER</h4>');
  });

  it('keeps site-relative and https links, drops other schemes', () => {
    expect(renderProse('[a](/projects)')).toContain('<a href="/projects">a</a>');
    expect(renderProse('[b](https://x.example)')).toContain('rel="noopener"');
    expect(renderProse('[c](javascript:alert(1))')).not.toContain('<a');
  });

  it('splits blank lines into paragraphs', () => {
    expect(renderProse('one\n\ntwo')).toBe('<p>one</p><p>two</p>');
  });

  it('renders "- " lines as a bullet list, mixed with paragraphs', () => {
    const html = renderProse('intro line\n- first\n- **second**\nafter');
    expect(html).toContain('<p>intro line</p>');
    expect(html).toContain('<ul><li>first</li><li><b>second</b></li></ul>');
    expect(html).toContain('<p>after</p>');
  });
});
