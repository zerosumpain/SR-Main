import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { publishBuild } from '$lib/jkai/sandbox';
import { resolvePublishSlug } from '$lib/jkai/publish-slug';
import { normaliseCardFields } from '$lib/jkai/project-card';

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

  // Promote sends the curated card alongside the slug; the bare Publish button
  // sends neither and leaves whatever is already stored untouched.
  const card = normaliseCardFields(body);
  if (!card.ok) return json({ error: card.error }, { status: 400 });

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
        .set({ publishedSlug: finalSlug, ...card.fields, updatedAt: new Date() })
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

/**
 * Edit the card of an already-published build, without touching its files.
 *
 * Re-running POST would work, but publishing re-installs dependencies and
 * re-runs the project's build inside the sandbox — minutes of work to change a
 * sentence of copy. Rewording a blurb must not risk the live page.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build) return json({ error: 'Build not found' }, { status: 404 });
  if (!build.publishedSlug) {
    return json({ error: 'This build is not published yet — promote it first' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const card = normaliseCardFields(body);
  if (!card.ok) return json({ error: card.error }, { status: 400 });

  await db
    .update(jkaiBuilds)
    .set({ ...card.fields, updatedAt: new Date() })
    .where(eq(jkaiBuilds.id, params.id));

  return json({
    ok: true,
    slug: build.publishedSlug,
    url: `/projects/${build.publishedSlug}/`,
  });
};
