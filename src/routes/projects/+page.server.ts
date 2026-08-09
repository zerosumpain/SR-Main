import { db } from '$lib/db';
import { jkaiBuilds, projectVisibility } from '$lib/db/schema';
import { isNotNull, desc } from 'drizzle-orm';
import { resolveVisibilityMap, isProjectPublic } from '$lib/projects/visibility';
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
      .where(isNotNull(jkaiBuilds.publishedSlug))
      .orderBy(desc(jkaiBuilds.updatedAt)),
    db
      .select({ projectKey: projectVisibility.projectKey, isPublic: projectVisibility.isPublic })
      .from(projectVisibility),
  ]);

  const visibility = resolveVisibilityMap(visRows);

  // Attach each build's resolved visibility; hide private builds from the public.
  const withVis = published.map((p) => ({
    ...p,
    isPublic: isProjectPublic(visibility, p.publishedSlug!),
  }));
  const projects = authenticated ? withVis : withVis.filter((p) => p.isPublic);

  return { projects, authenticated, visibility };
};
