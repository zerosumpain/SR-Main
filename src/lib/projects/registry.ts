import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { isNotNull } from 'drizzle-orm';
import { STATIC_PROJECT_KEYS, isProjectSlug } from './visibility';

// The static card keys live in ./visibility, next to the default they decide,
// and are re-exported here because that is where every caller already imports
// them from.
export { STATIC_PROJECT_KEYS };

// Keys that may legitimately be toggled: the static cards plus any currently
// published AI build. Used to validate the visibility API so arbitrary rows
// can't be written.
//
// A git-target build's `publishedSlug` is a PR URL or branch ref, not an
// address (see isProjectSlug) — those are filtered out, so a toggle can no
// longer write a `project_visibility` row keyed on a GitHub URL. The 15 such
// rows prod accumulated are exactly what that used to produce.
export async function getAllowedProjectKeys(): Promise<Set<string>> {
  const builds = await db
    .select({ slug: jkaiBuilds.publishedSlug })
    .from(jkaiBuilds)
    .where(isNotNull(jkaiBuilds.publishedSlug));
  const keys = new Set<string>(STATIC_PROJECT_KEYS);
  for (const b of builds) if (isProjectSlug(b.slug)) keys.add(b.slug);
  return keys;
}
