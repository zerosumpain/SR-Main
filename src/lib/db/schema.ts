import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';

export const blogPosts = pgTable('blog_posts', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  excerpt: text('excerpt').notNull(),
  content: text('content').notNull(),
  coverImageUrl: text('cover_image_url'),
  status: text('status').notNull().default('draft'),
  publishedAt: timestamp('published_at'),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

export const blogPostTags = pgTable('blog_post_tags', {
  id: serial('id').primaryKey(),
  postId: integer('post_id')
    .notNull()
    .references(() => blogPosts.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(),
});
