import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { isNotNull, desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const session = await locals.auth();

  const published = await db
    .select({
      id: jkaiBuilds.id,
      title: jkaiBuilds.title,
      prompt: jkaiBuilds.prompt,
      publishedSlug: jkaiBuilds.publishedSlug,
      iterationsCompleted: jkaiBuilds.iterationsCompleted,
      createdAt: jkaiBuilds.createdAt,
    })
    .from(jkaiBuilds)
    .where(isNotNull(jkaiBuilds.publishedSlug))
    .orderBy(desc(jkaiBuilds.updatedAt));

  return {
    projects: published,
    authenticated: !!session?.user,
  };
};
