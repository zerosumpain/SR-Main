import { describe, it, expect } from 'vitest';
import type { PostMeta } from '$lib/blog/types';

describe('PostMeta type', () => {
  it('has the expected shape', () => {
    const post: PostMeta = {
      slug: 'test-post',
      title: 'Test Post',
      excerpt: 'A test post',
      publishedAt: '2026-01-01T00:00:00Z',
    };
    expect(post.slug).toBe('test-post');
    expect(post.title).toBe('Test Post');
  });
});
