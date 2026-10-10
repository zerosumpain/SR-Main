import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ContentsRows from './ContentsRows.svelte';
import LatestCard from './LatestCard.svelte';
import type { ContentsPost } from './contents';

const post = (slug: string, publishedAt: string | null, tags: string[] = [], coverImageUrl: string | null = null): ContentsPost => ({
  slug,
  title: `Title ${slug}`,
  excerpt: `About ${slug}`,
  tags,
  publishedAt,
  coverImageUrl,
});

const run = [
  post('newest', '2026-10-04T09:00:00Z', ['notes', 'a b']),
  post('middle', '2026-03-02T09:00:00Z', [], 'https://example.test/c.png'),
  post('oldest', '2025-12-12T09:00:00Z'),
];

describe('blog contents components', () => {
  it('lists the run by year, numbered by place, each title the one row link', () => {
    const body = render(ContentsRows, { props: { posts: run } }).body;
    expect(body).toMatch(/<h3[^>]*>2026(<!---->)?<\/h3>/);
    expect(body).toMatch(/<h3[^>]*>2025(<!---->)?<\/h3>/);
    // The second year's list starts at the third post, so the numbering carries on.
    expect(body).toMatch(/<ol[^>]*start="3"/);
    expect(body).toMatch(/<a class="cr-link[^"]*" href="\/blog\/newest">Title newest<\/a>/);
    expect(body).toContain('href="/blog/tag/a%20b"');
    expect(body).toMatch(/<time[^>]*datetime="2026-10-04"[^>]*>4 Oct<\/time>/);
    expect(body).toMatch(/class="cr-num[^"]*" aria-hidden="true">3</);
    expect(body).not.toContain('<img');
  });

  it('pastes in covers and drops the numbers on a tag page', () => {
    const body = render(ContentsRows, { props: { posts: run, numbered: false, thumbs: true, yearAs: 'h2' } }).body;
    expect(body).toMatch(/<h2[^>]*>2026(<!---->)?<\/h2>/);
    expect(body).toMatch(/<img src="https:\/\/example\.test\/c\.png" alt=""/);
    expect(body).not.toContain('cr-num');
  });

  it('pins the newest post as a card whose title is its only link to the post', () => {
    const body = render(LatestCard, { props: { post: run[0] } }).body;
    expect(body).toMatch(/<article class="np-card lc/);
    expect(body.match(/href="\/blog\/newest"/g)?.length).toBe(1);
    expect(body).toContain('4 Oct 2026');
  });
});
