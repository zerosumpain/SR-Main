import { register } from '../registry-internal';
import { db } from '$lib/db';
import { blogPosts } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';

register({
  name: 'blog_list',
  description: 'List blog posts with title, slug, status (draft/published), excerpt, and timestamps',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', description: 'Filter by status: "draft" or "published". Omit for all.' },
    },
  },
  category: 'Blog',
  handler: async () => {
    const rows = await db.select().from(blogPosts).orderBy(desc(blogPosts.createdAt)).limit(50);
    return { success: true, data: rows };
  },
});

register({
  name: 'blog_get',
  description: 'Get full blog post content, tags, and metadata by ID',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number', description: 'Blog post ID' } },
    required: ['id'],
  },
  category: 'Blog',
  handler: async (args) => {
    const id = Number(args.id);
    if (isNaN(id)) return { success: false, error: 'Invalid ID — must be a number' };
    const [post] = await db.select().from(blogPosts).where(eq(blogPosts.id, id)).limit(1);
    return post ? { success: true, data: post } : { success: false, error: 'Post not found' };
  },
});

register({
  name: 'blog_create',
  description: 'Create a new blog post',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Post title' },
      slug: { type: 'string', description: 'URL slug (auto-generated from title if omitted)' },
      excerpt: { type: 'string', description: 'Short excerpt/summary' },
      content: { type: 'string', description: 'Post content (markdown or HTML)' },
      status: { type: 'string', description: '"draft" (default) or "published"' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tag names' },
    },
    required: ['title', 'content'],
  },
  category: 'Blog',
  handler: async (args) => {
    const title = args.title as string;
    const slug = (args.slug as string) || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const excerpt = (args.excerpt as string) || (args.content as string).slice(0, 200);
    const [post] = await db.insert(blogPosts).values({
      title,
      slug,
      excerpt,
      content: args.content as string,
      status: (args.status as string) || 'draft',
    }).returning();
    return { success: true, data: post };
  },
});

register({
  name: 'blog_update',
  description: 'Update an existing blog post (title, content, status, tags)',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Blog post ID' },
      title: { type: 'string', description: 'New title' },
      content: { type: 'string', description: 'New content' },
      status: { type: 'string', description: '"draft" or "published"' },
      tags: { type: 'array', items: { type: 'string' }, description: 'New tag names (replaces existing)' },
    },
    required: ['id'],
  },
  category: 'Blog',
  handler: async (args) => {
    const updates: Record<string, unknown> = {};
    if (args.title) updates.title = args.title;
    if (args.content) updates.content = args.content;
    if (args.status) updates.status = args.status;
    const id = Number(args.id);
    if (isNaN(id)) return { success: false, error: 'Invalid ID — must be a number' };
    const [post] = await db.update(blogPosts).set(updates).where(eq(blogPosts.id, id)).returning();
    return post ? { success: true, data: post } : { success: false, error: 'Post not found' };
  },
});

register({
  name: 'blog_unpublish',
  description: 'Unpublish a blog post — sets its status back to draft',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number', description: 'Blog post ID' } },
    required: ['id'],
  },
  category: 'Blog',
  handler: async (args) => {
    const [post] = await db
      .update(blogPosts)
      .set({ status: 'draft' })
      .where(eq(blogPosts.id, Number(args.id)))
      .returning();
    return post ? { success: true, data: post } : { success: false, error: 'Post not found' };
  },
});
