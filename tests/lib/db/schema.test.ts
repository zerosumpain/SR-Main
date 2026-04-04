import { describe, it, expect } from 'vitest';
import { blogPosts, blogPostTags } from '$lib/db/schema';

describe('blog schema', () => {
  it('blogPosts table has expected columns', () => {
    expect(blogPosts.slug).toBeDefined();
    expect(blogPosts.title).toBeDefined();
    expect(blogPosts.status).toBeDefined();
    expect(blogPosts.publishedAt).toBeDefined();
  });

  it('blogPostTags references blogPosts', () => {
    expect(blogPostTags.postId).toBeDefined();
    expect(blogPostTags.tag).toBeDefined();
  });

  it('blogPosts has contentFormat column', () => {
    expect(blogPosts.contentFormat).toBeDefined();
  });

  it('blogPosts has previewToken column', () => {
    expect(blogPosts.previewToken).toBeDefined();
  });
});
