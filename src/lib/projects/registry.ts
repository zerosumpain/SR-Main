import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { isNotNull, or } from 'drizzle-orm';
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
  // Both columns, because a build can carry an address in either: an app build
  // publishes to `publishedSlug`, whilst a change request records the page it
  // added to the repo in `projectSlug` and keeps its PR url in the other. A key
  // that is only in `projectSlug` still has to be toggleable, or the card the
  // build menu just created could never be made public.
  const builds = await db
    .select({ slug: jkaiBuilds.publishedSlug, projectSlug: jkaiBuilds.projectSlug })
    .from(jkaiBuilds)
    .where(or(isNotNull(jkaiBuilds.publishedSlug), isNotNull(jkaiBuilds.projectSlug)));
  const keys = new Set<string>(STATIC_PROJECT_KEYS);
  for (const b of builds) {
    if (isProjectSlug(b.slug)) keys.add(b.slug);
    if (isProjectSlug(b.projectSlug)) keys.add(b.projectSlug);
  }
  return keys;
}
