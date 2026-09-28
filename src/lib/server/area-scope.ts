// Whose rows a request may read or change in one area — the seam every area
// that opens to members reads through (spec: access groups §4).
//
// Reaching a route is the hook's decision ($lib/access/catalogue); which ROWS
// come back is this one's. Each area's owned rows carry a `principal_id`:
// 'owner' (John's — the default, so every row that existed before the area
// opened stays his), 'household' (shared), or a member's `u_…`.
//
//   owner              everything
//   verified service   only the areas assigned by its authenticated entry point
//   anonymous          forbidden
//   self                reads own + household, writes own
//   all                 reads every member's + household (never the owner's),
//                       writes own
//   admin               reads and writes every member's + household
//   anyone else         403
//
// Row scope is enforced here independently of the database runtime role.

import { error } from '@sveltejs/kit';
import { levelOf, type AreaId } from '$lib/access/catalogue';
import { OWNER_ACCESS, type AreaAccess } from './area-predicates';

export {
  OWNER_PRINCIPAL,
  HOUSEHOLD_PRINCIPAL,
  OWNER_ACCESS,
  readable,
  writable,
  canRead,
  canWrite,
  type AreaAccess,
} from './area-predicates';
import { viewerOf } from './viewer';

export async function areaAccess(event: { locals: App.Locals }, area: AreaId): Promise<AreaAccess> {
  const viewer = await viewerOf(event);
  if (viewer.kind === 'owner' || (viewer.kind === 'anonymous' && event.locals.serviceAreas?.includes(area))) return OWNER_ACCESS;
  if (viewer.kind === 'member') {
    const level = levelOf(viewer.grants, area);
    if (level) return { level, own: viewer.principalId };
  }
  throw error(403, 'Forbidden');
}

