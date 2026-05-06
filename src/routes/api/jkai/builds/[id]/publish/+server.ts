import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { publishBuild } from '$lib/jkai/sandbox';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export const POST: RequestHandler = async ({ params }) => {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build) return json({ error: 'Build not found' }, { status: 404 });

  // Generate slug from title or prompt
  const base = slugify(build.title || build.prompt.slice(0, 60));
  const slug = base || params.id.slice(0, 8);

  // Check for slug collision (different build)
  const [existing] = await db
    .select()
    .from(jkaiBuilds)
    .where(eq(jkaiBuilds.publishedSlug, slug));

  const finalSlug = existing && existing.id !== build.id
    ? `${slug}-${params.id.slice(0, 6)}`
    : slug;

  try {
    await publishBuild(params.id, finalSlug);

    await db
      .update(jkaiBuilds)
      .set({ publishedSlug: finalSlug, updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, params.id));

    return json({ ok: true, slug: finalSlug, url: `/projects/${finalSlug}/` });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
};
