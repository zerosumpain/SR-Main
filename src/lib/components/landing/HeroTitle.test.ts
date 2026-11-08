import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import HeroTitle from './HeroTitle.svelte';

describe('HeroTitle', () => {
  it('sets the tagline it is given under the title', () => {
    const html = render(HeroTitle, { props: { tagline: 'Something else entirely.' } }).body;
    expect(html).toMatch(/<p class="ht-lede[^"]*">Something else entirely\.<\/p>/);
    expect(html.match(/<h1\b/g)?.length).toBe(1);
  });

  it('renders the tagline as text, never as markup', () => {
    const html = render(HeroTitle, { props: { tagline: '<img src=x onerror=alert(1)> & <b>bold</b>' } }).body;
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)> &amp; &lt;b>bold&lt;/b>');
  });

  it('keeps curly quotes as typed', () => {
    const html = render(HeroTitle, { props: { tagline: 'JK’s “line”' } }).body;
    expect(html).toContain('JK’s “line”');
  });
});
