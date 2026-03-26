import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { unpublishBuild } from '$lib/jkai/sandbox';

export const POST: RequestHandler = async ({ params }) => {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build) return json({ error: 'Build not found' }, { status: 404 });
  if (!build.publishedSlug) return json({ error: 'Build is not published' }, { status: 400 });

  try {
    await unpublishBuild(build.publishedSlug);

    await db
      .update(jkaiBuilds)
      .set({ publishedSlug: null, updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, params.id));

    return json({ ok: true });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
};
