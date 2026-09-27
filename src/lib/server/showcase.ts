// The admin showcase: a read-only tour of the admin pages for someone holding
// `admin:self` ($lib/access/catalogue), to see how the site runs.
//
// The hook lets a non-owner reach an admin page only through the catalogue, so
// anyone who is not the owner inside an admin load IS a showcase viewer. Each
// showcase page's load strips what is personal or secret before returning —
// never in the template, because everything a load returns is serialised into
// the page's __data.json whether the page renders it or not.
//
// Writes are refused by the hook: the catalogue opens these routes for GET only,
// so every form action and API write is owner-only as before.
import { isOwnerRequest, type OwnerCheckEvent } from './owner';

/** True when this admin request is a showcase visitor, not the owner. */
export async function isShowcase(event: OwnerCheckEvent): Promise<boolean> {
  return !(await isOwnerRequest(event));
}
