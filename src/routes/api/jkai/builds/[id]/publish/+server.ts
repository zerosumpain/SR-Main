import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { publishBuild } from '$lib/jkai/sandbox';
import { resolvePublishSlug } from '$lib/jkai/publish-slug';

export const POST: RequestHandler = async ({ params, request }) => {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build) return json({ error: 'Build not found' }, { status: 404 });

  // An explicit slug is how a rewritten app replaces the page it already owns.
  // Optional: the Publish button sends no body and keeps the derived address.
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const requested = typeof body?.slug === 'string' ? body.slug.trim() : '';

  const resolved = resolvePublishSlug(build, requested);
  if (!resolved.ok) return json({ error: resolved.error }, { status: 400 });
  const slug = resolved.slug;

  const [existing] = await db
    .select()
    .from(jkaiBuilds)
    .where(eq(jkaiBuilds.publishedSlug, slug));
  const collides = existing && existing.id !== build.id;

  // A derived slug that collides gets suffixed, as before — that is an
  // accident of naming. A slug the caller typed is an instruction to replace,
  // so it takes the address over and the old holder gives it up.
  const finalSlug = collides && !requested ? `${slug}-${params.id.slice(0, 6)}` : slug;

  try {
    await publishBuild(params.id, finalSlug);

    await db.transaction(async (tx) => {
      if (collides && requested) {
        await tx
          .update(jkaiBuilds)
          .set({ publishedSlug: null, updatedAt: new Date() })
          .where(eq(jkaiBuilds.id, existing.id));
      }
      await tx
        .update(jkaiBuilds)
        .set({ publishedSlug: finalSlug, updatedAt: new Date() })
        .where(eq(jkaiBuilds.id, params.id));
    });

    return json({
      ok: true,
      slug: finalSlug,
      url: `/projects/${finalSlug}/`,
      replaced: collides && requested ? existing.id : undefined,
    });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
};
