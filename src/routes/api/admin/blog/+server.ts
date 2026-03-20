import { json } from '@sveltejs/kit';
import { validateSession } from '$lib/auth';
import { db } from '$lib/db';
import { blogPosts, blogPostTags } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

function authorize(request: Request, url: URL): boolean {
  const token = url.searchParams.get('token');
  const cookie = request.headers.get('cookie');
  const session = cookie
    ?.split(';')
    .find((c) => c.trim().startsWith('admin_session='))
    ?.split('=')[1];
  return validateSession(session) || validateSession(token ?? undefined);
}

// GET /api/admin/blog — list all posts (drafts + published)
export const GET: RequestHandler = async ({ request, url }) => {
  if (!authorize(request, url)) return json({ error: 'Unauthorized' }, { status: 401 });

  const posts = await db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      status: blogPosts.status,
      publishedAt: blogPosts.publishedAt,
      createdAt: blogPosts.createdAt,
      updatedAt: blogPosts.updatedAt,
    })
    .from(blogPosts)
    .orderBy(desc(blogPosts.updatedAt));

  return json(posts);
};

// POST /api/admin/blog — create a new post
export const POST: RequestHandler = async ({ request, url }) => {
  if (!authorize(request, url)) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { title, slug, excerpt, content, tags } = body;

  if (!title || !slug) return json({ error: 'Title and slug are required' }, { status: 400 });

  const now = new Date();
  const [post] = await db
    .insert(blogPosts)
    .values({
      title,
      slug,
      excerpt: excerpt || '',
      content: content || '',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (tags?.length) {
    await db.insert(blogPostTags).values(tags.map((tag: string) => ({ postId: post.id, tag })));
  }

  return json(post, { status: 201 });
};
