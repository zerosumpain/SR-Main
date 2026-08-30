import { describe, it, expect } from 'vitest';
import type { PostMeta, Post } from '$lib/blog/types';

describe('PostMeta type', () => {
  it('has the expected shape with coverImageUrl and tags', () => {
    const post: PostMeta = {
      slug: 'test-post',
      title: 'Test Post',
      excerpt: 'A test post',
      coverImageUrl: null,
      coverImageAlt: null,
      tags: ['tech', 'svelte'],
      publishedAt: '2026-01-01T00:00:00Z',
    };
    expect(post.slug).toBe('test-post');
    expect(post.title).toBe('Test Post');
    expect(post.coverImageUrl).toBeNull();
    expect(post.tags).toEqual(['tech', 'svelte']);
  });
});

describe('Post type', () => {
  it('extends PostMeta with content, contentFormat, previewToken', () => {
    const post: Post = {
      slug: 'test-post',
      title: 'Test Post',
      excerpt: 'A test post',
      id: 1,
      coverImageUrl: '/img/cover.png',
      coverImageAlt: 'A cover',
      tags: ['tech'],
      publishedAt: '2026-01-01T00:00:00Z',
      content: '<p>Hello</p>',
      contentFormat: 'html',
      bodyFont: 'read',
      previewToken: 'abc-123',
    };
    expect(post.content).toBe('<p>Hello</p>');
    expect(post.contentFormat).toBe('html');
    expect(post.previewToken).toBe('abc-123');
  });

  it('supports markdown contentFormat', () => {
    const post: Post = {
      slug: 'md-post',
      title: 'MD Post',
      excerpt: 'A markdown post',
      id: 2,
      coverImageUrl: null,
      coverImageAlt: null,
      tags: [],
      publishedAt: null,
      content: '**bold**',
      contentFormat: 'markdown',
      bodyFont: 'body',
      previewToken: 'xyz-456',
    };
    expect(post.contentFormat).toBe('markdown');
  });
});
