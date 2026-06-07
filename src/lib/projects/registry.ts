import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { isNotNull } from 'drizzle-orm';

// The hardcoded "Field Study" cards on /projects, keyed by their URL segment
// (the part after /projects/). AI-built projects are keyed by their publishedSlug.
export const STATIC_PROJECT_KEYS = [
  'dfe-data-estate',
  'policy-engine',
  'whitehall',
  'brass-and-rails',
  'data-convergence',
] as const;

// Keys that may legitimately be toggled: the static cards plus any currently
// published AI build. Used to validate the visibility API so arbitrary rows
// can't be written.
export async function getAllowedProjectKeys(): Promise<Set<string>> {
  const builds = await db
    .select({ slug: jkaiBuilds.publishedSlug })
    .from(jkaiBuilds)
    .where(isNotNull(jkaiBuilds.publishedSlug));
  const keys = new Set<string>(STATIC_PROJECT_KEYS);
  for (const b of builds) if (b.slug) keys.add(b.slug);
  return keys;
}
