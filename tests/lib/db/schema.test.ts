import { describe, it, expect } from 'vitest';
import { blogPosts, blogPostTags, blogAssistantMessages } from '$lib/db/schema';

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

describe('blogPosts new column', () => {
  it('blogPosts has coverImageAlt column', () => {
    expect(blogPosts.coverImageAlt).toBeDefined();
  });
});

describe('blogAssistantMessages schema', () => {
  it('exists with role, content, postId, createdAt', () => {
    expect(blogAssistantMessages.id).toBeDefined();
    expect(blogAssistantMessages.postId).toBeDefined();
    expect(blogAssistantMessages.role).toBeDefined();
    expect(blogAssistantMessages.content).toBeDefined();
    expect(blogAssistantMessages.createdAt).toBeDefined();
  });
});
