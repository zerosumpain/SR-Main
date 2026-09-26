// Whose file a drive name is — the member namespace of `workflow_files`.
//
// The drive is ONE flat table keyed on a unique `name`, and every file before
// access groups is the owner's. A member's files live under a reserved name
// prefix, `members/<principalId>/…`, and carry that principal in
// `workflow_files.principal_id`. The invariant the two lanes keep:
//
//     principal_id === principalForName(name)
//
// so a row can be judged from its name alone, and no rename may carry a file
// across principals (`fitsPrincipal`).
//
// The OWNER lane — the agent tools, workflow nodes, search, intel — reads only
// `principal_id = 'owner'` and may not write a name under the root
// (`isReservedForOwnerLane`). The MEMBER lane (SR-Drive) sees names relative
// to `memberViewRoot()` and translates at its edge with `toView` / `toStored`.
//
// Case-SENSITIVE throughout, like the unique index on `name`: only the exact
// lowercase `members/` is the root. `Members/u_x/a.pdf` is an ordinary owner
// file, and never collides with a member's, because Postgres compares names
// byte for byte. Folding case in one function and not another would break the
// invariant above, which is the thing everything else leans on.
//
// Pure and import-free on purpose: SR-Drive holds this file byte for byte
// (shared-with-extracted.json), and the owner-lane writers it guards are
// bundled into sidecars that must not pull in anything heavier.

export const MEMBER_ROOT = 'members/';

const OWNER = 'owner';

/** The principal segment of a name under the root, or null when there is none worth the name. */
function principalSegment(name: string): string | null {
  if (!name.startsWith(MEMBER_ROOT)) return null;
  const rest = name.slice(MEMBER_ROOT.length);
  const slash = rest.indexOf('/');
  const segment = slash < 0 ? rest : rest.slice(0, slash);
  if (segment === '' || segment === '.' || segment === '..') return null;
  return segment;
}

/**
 * Whose a name is: `members/<p>/…` → `p`; everything else → 'owner'.
 *
 * A bare `members/<p>` (no trailing path) is that principal's folder, so it is
 * theirs too. A name under the root with NO usable principal segment —
 * `members/` itself, `members//x`, `members/../x` — reads as 'owner' AND is
 * reserved: no member lane may write it (it is not theirs) and the owner lane
 * may not either (`isReservedForOwnerLane`). It belongs to nobody who can
 * create it, which is the point.
 */
export function principalForName(name: string): string {
  return principalSegment(name) ?? OWNER;
}

/** True for any name under the member root: the owner lane may not write these. */
export function isReservedForOwnerLane(name: string): boolean {
  return name.startsWith(MEMBER_ROOT);
}

/** The name prefix a member's view is rooted at. The owner's root is ''. */
export function memberViewRoot(): string {
  return MEMBER_ROOT;
}

/** A stored name as a viewer rooted at `root` sees it, or null when it lies outside that view. */
export function toView(stored: string, root: string): string | null {
  if (!root) return stored;
  if (!stored.startsWith(root)) return null;
  return stored.slice(root.length);
}

/**
 * A viewer's name translated back to the stored one, or null when the name is
 * not one a viewer may send: a leading '/', a '.' or '..' segment, a backslash
 * or a NUL. Rejecting rather than normalising — a name that tries to climb out
 * of its root is an attack or a bug, and neither should be quietly repaired
 * into something that works.
 */
export function toStored(view: string, root: string): string | null {
  if (view.startsWith('/') || view.includes('\\') || view.includes('\0')) return null;
  for (const segment of view.split('/')) if (segment === '.' || segment === '..') return null;
  return `${root}${view}`;
}

/**
 * True when `name` may be held by `principalId`: its name says it is theirs,
 * and — for the owner — it is not under the reserved root. The check for an
 * upload, a rename and a move alike.
 */
export function fitsPrincipal(name: string, principalId: string): boolean {
  if (principalId === OWNER) return !isReservedForOwnerLane(name);
  return principalSegment(name) === principalId;
}
