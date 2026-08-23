// Give a change-request build a card on /projects.
//
// An app build is COPIED to /projects by the publish endpoint next door, which
// moves files and writes `publishedSlug`. Nothing is copied here: a change
// request's page is already in the repo and already deployed, so all that is
// missing is the row connecting the build to the address it created. This
// writes `projectSlug` and the card copy, and nothing else.
//
// GET    detect the address from the PR's file list
// POST   save it, with the curated card copy
// DELETE withdraw the card (the page stays in the repo, and stays deployed)

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { detectProjectSlug } from '$lib/projects/detect-slug';
import { isProjectSlug, STATIC_PROJECT_KEYS } from '$lib/projects/visibility';
import { listPrFiles, prNumberFromUrl } from '$lib/github/pr';

async function loadBuild(id: string) {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, id));
  if (!build) throw error(404, 'Build not found');
  return build;
}

export const GET: RequestHandler = async ({ params }) => {
  const build = await loadBuild(params.id);

  // Already carded — hand back what it has rather than re-reading the PR.
  if (build.projectSlug) {
    return json({
      slug: build.projectSlug,
      candidates: [build.projectSlug],
      alreadySet: true,
      cardTitle: build.cardTitle,
      cardBlurb: build.cardBlurb,
      cardTag: build.cardTag,
    });
  }

  const prNumber = prNumberFromUrl(build.publishedSlug);
  if (!prNumber) {
    // A build with no PR has no file list to read. Say which of the two
    // reasons it is, because "no card available" is not actionable.
    return json({
      slug: null,
      candidates: [],
      reason: build.publishedSlug
        ? 'This build published a branch rather than a pull request, so there is no file list to read. Enter the address by hand.'
        : 'This build has not opened a pull request yet.',
    });
  }

  let files: string[];
  try {
    files = await listPrFiles(prNumber);
  } catch (err) {
    return json({
      slug: null,
      candidates: [],
      reason: `Could not read the pull request: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const detected = detectProjectSlug(files);
  return json({
    slug: detected?.slug ?? null,
    candidates: detected?.candidates ?? [],
    reason: detected ? undefined : 'This pull request added no page under src/routes/projects/.',
  });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const build = await loadBuild(params.id);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
  if (!isProjectSlug(slug)) {
    return json({ error: 'slug must be a single lowercase address segment' }, { status: 400 });
  }
  // A static card already owns its key and renders its own hand-written block
  // on the index; a second card on the same key would render twice and the
  // visibility toggle would be ambiguous about which one it moved.
  if ((STATIC_PROJECT_KEYS as readonly string[]).includes(slug)) {
    return json(
      { error: `/projects/${slug} is a hand-built card already on the index.` },
      { status: 409 },
    );
  }
  // The same reasoning across builds: one address, one card.
  const [clash] = await db
    .select({ id: jkaiBuilds.id })
    .from(jkaiBuilds)
    .where(eq(jkaiBuilds.projectSlug, slug));
  if (clash && clash.id !== build.id) {
    return json({ error: `/projects/${slug} already has a card from another build.` }, { status: 409 });
  }

  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

  await db
    .update(jkaiBuilds)
    .set({
      projectSlug: slug,
      cardTitle: text(body?.cardTitle, 120),
      cardBlurb: text(body?.cardBlurb, 400),
      cardTag: text(body?.cardTag, 60),
      updatedAt: new Date(),
    })
    .where(eq(jkaiBuilds.id, build.id));

  // Deliberately no `project_visibility` row: an address without one is
  // PRIVATE, so the card appears for the owner and the index toggle is what
  // makes it public. Adding a card must never publish a page by itself.
  return json({ slug, url: `/projects/${slug}/`, isPublic: false });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const build = await loadBuild(params.id);
  await db
    .update(jkaiBuilds)
    .set({ projectSlug: null, updatedAt: new Date() })
    .where(eq(jkaiBuilds.id, build.id));
  // The page itself is repo code and stays deployed. Only the card goes.
  return json({ ok: true });
};
