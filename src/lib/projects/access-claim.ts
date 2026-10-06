// The project visibility/share decision Main signs for an extracted project
// application (SR-Policy-Engine, SR-DfE-Data-Strategy, SR-Data-Standard-Designer,
// SR-DataSpine, Supply Chain Monitor).
//
// Those applications used to read `project_visibility` and `project_share`
// themselves and bump the share's use count from their own process. Now the
// edge gateway forwards the request's `?t=` and cookie to Main's session
// authority, Main answers with the same rules `requireProjectPublic` applies
// here, and the gateway signs that answer into the app's assertion. The usage
// bump happens where the share is validated, in Main.

import { isOwnerEmail } from '$lib/server/access';
import { db } from '$lib/db';
import { projectVisibility } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { isProjectPublic } from './visibility';
import { shareCookieName, validateProjectShare } from './shares';

/**
 * Which project each audience serves. Fixed here, not taken from the request:
 * an application's gateway key can only ever learn about its own project.
 */
export const PROJECT_AUDIENCES: Readonly<Record<string, string>> = Object.freeze({
  'sr-policy-engine': 'policy-engine',
  'sr-dfe-data-strategy': 'dfe-data-strategy',
  'sr-data-standard-designer': 'data-standard-designer',
  'sr-data-spine': 'data-spine',
  'sr-supply-chain-monitor': 'supply-chain-monitor',
});

export type ProjectAccess = 'public' | 'owner' | 'share' | 'none';

export function projectKeyForAudience(audience: string): string | null {
  return Object.hasOwn(PROJECT_AUDIENCES, audience) ? PROJECT_AUDIENCES[audience] : null;
}

function cookieValue(header: string, name: string): string {
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

/**
 * The decision, in the order `requireProjectPublic` takes it: public; the owner
 * previewing a private project; a live share link (`?t=` first, then the
 * project cookie, never falling back from a bad URL token); otherwise none.
 * `email` is the EFFECTIVE person — the view-as target while view-as holds, so
 * the owner viewing as a member sees what that member sees.
 */
export async function projectAccessFor(
  key: string,
  email: string | null,
  share: { fromUrl: string | null; cookie: string },
): Promise<{ key: string; access: ProjectAccess }> {
  const [vis] = await db
    .select({ projectKey: projectVisibility.projectKey, isPublic: projectVisibility.isPublic })
    .from(projectVisibility)
    .where(eq(projectVisibility.projectKey, key));
  const map = vis ? { [vis.projectKey]: vis.isPublic } : {};
  if (isProjectPublic(map, key)) return { key, access: 'public' };
  if (email && isOwnerEmail(email)) return { key, access: 'owner' };
  const token = share.fromUrl || cookieValue(share.cookie, shareCookieName(key));
  if (token && token.length <= 512 && (await validateProjectShare(key, token))) return { key, access: 'share' };
  return { key, access: 'none' };
}
