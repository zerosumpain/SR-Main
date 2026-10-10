import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import PostSheet from './PostSheet.svelte';

const post = {
  slug: 'a-post',
  title: 'A post on ruled paper',
  excerpt: 'A line under the title.',
  publishedAt: '2026-09-28T09:00:00.000Z',
  tags: ['essays', 'craft'],
  coverImageUrl: null,
  coverImageAlt: null,
  bodyFont: 'mono',
};

const base = {
  post,
  readingTime: 11,
  articleHtml: '<p>Body.</p><h2 id="h-one">One</h2><p>More.</p>',
  toc: [
    { id: 'h-one', text: 'One', level: 2 as const },
    { id: 'h-two', text: 'Two', level: 2 as const },
  ],
  references: '<ol class="footnotes"><li>A source</li></ol>',
  bodyFontVar: 'var(--font-mono)',
};

const snippet = (html: string) => createRawSnippet(() => ({ render: () => html }));

describe('PostSheet', () => {
  it('sets one h1, the ruling for the post’s face and the measure for that face', () => {
    const html = render(PostSheet, { props: base }).body;
    expect(html.match(/<h1\b/g)?.length).toBe(1);
    expect(html).toContain('data-np-font="mono"');
    // The monospaced face keeps the wider columns: 39rem by default, scaled
    // with the reader's text size so the characters to a line hold.
    expect(html).toContain('--reader-measure: calc(39rem * var(--reader-scale, 1))');
    expect(html).toContain('--reader-scale: 1');
  });

  it('gives a proportional face the narrower default column', () => {
    const html = render(PostSheet, { props: { ...base, post: { ...post, bodyFont: 'read' } } }).body;
    expect(html).toContain('data-np-font="read"');
    expect(html).toContain('--reader-measure: calc(35rem * var(--reader-scale, 1))');
  });

  it('keeps the completion sentinel straight after the body, before the sources and the foot', () => {
    const html = render(PostSheet, {
      props: { ...base, foot: snippet('<section class="comments-stub">Responses</section>') },
    }).body;
    const body = html.indexOf('class="pp-body');
    const sentinel = html.indexOf('data-article-end');
    const sources = html.indexOf('A source');
    const foot = html.indexOf('comments-stub');
    expect(body).toBeGreaterThan(-1);
    expect(sentinel).toBeGreaterThan(html.lastIndexOf('More.'));
    expect(sources).toBeGreaterThan(sentinel);
    expect(foot).toBeGreaterThan(sentinel);
    // Nothing but the closing of the body lies between the prose and the sentinel.
    const between = html.slice(html.lastIndexOf('More.'), sentinel);
    expect(between).not.toMatch(/<(p|section|aside|figure|footer)\b/);
  });

  it('stamps a preview as a draft and links every tag', () => {
    const html = render(PostSheet, { props: { ...base, preview: true } }).body;
    expect(html).toContain('Draft');
    expect(html).toContain('href="/blog/tag/essays"');
    expect(html).toContain('href="/blog/tag/craft"');
  });

  it('dates a published post with a machine-readable time', () => {
    const html = render(PostSheet, { props: base }).body;
    expect(html).toContain('datetime="2026-09-28T09:00:00.000Z"');
    expect(html).toContain('28 Sept 2026');
  });
});
