import { db } from '$lib/db';
import { jkaiBuilds, projectVisibility } from '$lib/db/schema';
import { isNotNull, or, desc } from 'drizzle-orm';
import { resolveVisibilityMap, isProjectPublic, isProjectSlug } from '$lib/projects/visibility';
import { isOwnerEmail } from '$lib/server/access';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const session = await locals.auth();
  // Only the owner sees private projects + the visibility/remove controls; a
  // signed-in guest (non-owner) sees the same public listing as the public.
  const authenticated = isOwnerEmail(session?.user?.email);

  const [published, visRows] = await Promise.all([
    db
      .select({
        id: jkaiBuilds.id,
        title: jkaiBuilds.title,
        prompt: jkaiBuilds.prompt,
        publishedSlug: jkaiBuilds.publishedSlug,
        // The page a change request added to the repo. See schema.ts — a build
        // can carry an address in either column, never the same one in both.
        projectSlug: jkaiBuilds.projectSlug,
        // Curated card copy, written when the build was promoted. Null on
        // anything published before promotion existed — resolveProjectCard
        // falls those back to the title and prompt, exactly as before.
        cardTitle: jkaiBuilds.cardTitle,
        cardBlurb: jkaiBuilds.cardBlurb,
        cardTag: jkaiBuilds.cardTag,
        iterationsCompleted: jkaiBuilds.iterationsCompleted,
        createdAt: jkaiBuilds.createdAt,
        updatedAt: jkaiBuilds.updatedAt,
      })
      .from(jkaiBuilds)
      .where(or(isNotNull(jkaiBuilds.publishedSlug), isNotNull(jkaiBuilds.projectSlug)))
      .orderBy(desc(jkaiBuilds.updatedAt)),
    db
      .select({ projectKey: projectVisibility.projectKey, isPublic: projectVisibility.isPublic })
      .from(projectVisibility),
  ]);

  const visibility = resolveVisibilityMap(visRows);

  // A git-target build parks its PR URL / branch ref in `publishedSlug`, so
  // "has a publishedSlug" is not the same as "is a project". Those rendered
  // cards linking at /projects/https://github.com/... — drop them here rather
  // than relying on someone hiding each one by hand after it appears.
  //
  // `projectSlug` is the other way a build gets an address: a change request
  // that added a page to the repo and had a card flipped on from the build
  // menu. Collapse both into one `slug` so nothing downstream has to know
  // which column a card came from — the old code passed `publishedSlug!`
  // around, and that non-null assertion is exactly what would break here.
  const projectPublishes = published
    .map((p) => {
      // `source` tells the card which kind of thing it is looking at, so the
      // Remove button can pick the right call: a repo page has no published
      // files to delete, only a card to withdraw.
      const fromRepo = isProjectSlug(p.projectSlug);
      return {
        ...p,
        slug: fromRepo ? p.projectSlug : p.publishedSlug,
        source: fromRepo ? ('repo' as const) : ('build' as const),
      };
    })
    .filter((p) => isProjectSlug(p.slug));

  // Attach each build's resolved visibility; hide private builds from the
  // public. A build with no visibility row is PRIVATE (see $lib/projects/
  // visibility) — publishing does not put it on the index, the toggle does.
  const withVis = projectPublishes.map((p) => ({
    ...p,
    isPublic: isProjectPublic(visibility, p.slug!),
  }));
  const projects = authenticated ? withVis : withVis.filter((p) => p.isPublic);

  return { projects, authenticated, visibility };
};
