import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { blogPostTags } from '$lib/db/schema';
import { sql, desc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// GET /api/admin/blog/tags
// Returns the distinct list of tags currently in use across all blog posts,
// with usage counts, ordered by count desc (most-used tags first). Powers
// the autocomplete dropdown on the BlogCreate / BlogUpdate panels.
export const GET: RequestHandler = async () => {
  const rows = await db
    .select({
      tag: blogPostTags.tag,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(blogPostTags)
    .groupBy(blogPostTags.tag)
    .orderBy(desc(sql`count(*)`), blogPostTags.tag);

  return json({ tags: rows });
};
