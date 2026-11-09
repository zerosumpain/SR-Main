// The project visibility/share decision Main signs for an extracted project
// application (SR-Policy-Engine, SR-DfE-Data-Strategy, SR-Data-Standard-Designer,
// SR-DataSpine, SR-Spine, Supply Chain Monitor, Local Plan Navigator, Wildmind, Casebook).
//
// Those applications used to read `project_visibility` and `project_share`
// themselves and bump the share's use count from their own process. Now the
// edge gateway forwards the request's `?t=` and cookie to Main's session
// authority, Main answers with the same rules `requireProjectPublic` applies
// here, and the gateway signs that answer into the app's assertion. The usage
// bump happens where the share is validated, in Main.
//
// A share link can ask for a password (24 Oct 2026, the Spine only). Main does
// not ask it: the claim carries the link's verifier as `pass`, and the app puts
// the question and checks the answer ($lib/projects/share-password).
//
// A share link can also name an audience pack (8 Nov 2026, the Spine's 'dfe' or
// 'school'): the claim carries it as `pack`, and the app opens that pack alone
// ($lib/projects/share-pack). No pack, no key: the app's default.
//
// The gateway also says who is asking (24 Oct 2026): a visitor id, network,
// browser and whether the request opened a page, all reduced to hashes and
// labels before they reach here ($lib/projects/share-visitor). Only a share is
// counted; the owner (viewing as someone or not) and a public project's readers
// never are.

import { isOwnerEmail } from '$lib/server/access';
import { db } from '$lib/db';
import { projectVisibility } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { isProjectPublic } from './visibility';
import { shareCookieName, validateProjectShare } from './shares';
import type { ShareVisit } from './share-visitor';

/**
 * Which project each audience serves. Fixed here, not taken from the request:
 * an application's gateway key can only ever learn about its own project.
 */
export const PROJECT_AUDIENCES: Readonly<Record<string, string>> = Object.freeze({
  'sr-policy-engine': 'policy-engine',
  'sr-dfe-data-strategy': 'dfe-data-strategy',
  'sr-data-standard-designer': 'data-standard-designer',
  'sr-data-spine': 'data-spine',
  'sr-spine': 'spine',
  'sr-supply-chain-monitor': 'supply-chain-monitor',
  'sr-local-plan-navigator': 'local-plan-navigator',
  'sr-wildmind': 'wildmind',
  'sr-casebook': 'casebook',
});

export type ProjectAccess = 'public' | 'owner' | 'share' | 'none';

/**
 * `pass` only on a share whose link asks for a password: that link's verifier.
 * `pack` only on a share whose link names an audience pack.
 */
export interface ProjectClaim {
  key: string;
  access: ProjectAccess;
  pass?: string;
  pack?: string;
}

/**
 * Which share link a request came through, for the gateway's analytics tag
 * only ($lib/analytics/project-tracker). Never part of the signed claim: an
 * application is told whether it may serve the page, not who the link was
 * for. `ref` is the first 8 characters of the link's row id, never the token.
 */
export interface ShareAttribution {
  ref: string;
  label: string | null;
}

export function shareAttribution(live: { id: string; label: string | null }): ShareAttribution {
  const label = (live.label ?? '').replace(/[^\x20-\x7e\u00a0-\u024f]/g, '').trim().slice(0, 80);
  return { ref: live.id.replace(/[^0-9a-f]/gi, '').slice(0, 8).toLowerCase(), label: label || null };
}

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
 * the owner viewing as a member sees what that member sees. `count` false (the
 * owner behind view-as) answers the same and counts no use or visitor.
 */
export async function projectAccessFor(
  key: string,
  email: string | null,
  share: { fromUrl: string | null; cookie: string; visit?: ShareVisit | null; count?: boolean },
): Promise<ProjectClaim> {
  return (await projectAccessWithShare(key, email, share)).claim;
}

/** projectAccessFor, plus which link it was when the answer is a share. */
export async function projectAccessWithShare(
  key: string,
  email: string | null,
  share: { fromUrl: string | null; cookie: string; visit?: ShareVisit | null; count?: boolean },
): Promise<{ claim: ProjectClaim; attribution: ShareAttribution | null }> {
  const none = (claim: ProjectClaim) => ({ claim, attribution: null });
  const [vis] = await db
    .select({ projectKey: projectVisibility.projectKey, isPublic: projectVisibility.isPublic })
    .from(projectVisibility)
    .where(eq(projectVisibility.projectKey, key));
  const map = vis ? { [vis.projectKey]: vis.isPublic } : {};
  if (isProjectPublic(map, key)) return none({ key, access: 'public' });
  if (email && isOwnerEmail(email)) return none({ key, access: 'owner' });
  const token = share.fromUrl || cookieValue(share.cookie, shareCookieName(key));
  const live = token && token.length <= 512 ? await validateProjectShare(key, token, share.visit ?? null, share.count !== false) : null;
  if (live) {
    const claim: ProjectClaim = { key, access: 'share' };
    if (live.passwordHash) claim.pass = live.passwordHash;
    if (live.pack) claim.pack = live.pack;
    return { claim, attribution: shareAttribution(live) };
  }
  return none({ key, access: 'none' });
}
