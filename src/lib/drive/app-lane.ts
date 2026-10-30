// The phone's Drive: two places, and nothing else of the drive.
//
// The SR app gives every person on it (the owner, and a member holding
// `drive:self`) exactly two spaces:
//
//   mine     a member: `members/<their principal>/…`, nobody else's.
//            the owner: his own drive (principal 'owner'), as on /drive.
//   shared   `members/household/…` — the family's folder. Everyone on the
//            app reads it and adds to it; a file in it is deleted only by
//            whoever put it there (or the owner).
//
// Deliberately NARROWER than the web member lane in SR-Drive, which reads
// every member's folder at `drive:all`: on the phone a level never widens what
// is seen. "Their own storage area nobody else can see" is the promise, so
// another member's folder is unreachable here whatever they hold, and the
// owner's files are reachable only from the owner's phone.
//
// Pure and import-light, so every decision below is a unit test
// (app-lane.test.ts). The routes under /api/native/drive call these and
// nothing else to decide WHICH rows; $lib/drive/native-drive does the I/O.
//
// Names are as stored in `workflow_files.name` (globally unique, see
// ./namespace); the phone only ever sees them relative to a space's root.

import { MEMBER_ROOT, principalForName } from './namespace';

export const OWNER_PRINCIPAL = 'owner';
export const HOUSEHOLD_PRINCIPAL = 'household';
/** The zero-byte file that holds an empty folder open — SR-Drive's convention. Never listed. */
export const FOLDER_MARKER = '.keep';
/** Longest stored name, as SR-Drive's upload allows. */
export const MAX_STORED_NAME = 200;
/** Longest single file or folder name the phone may send. */
export const MAX_SEGMENT = 120;
/** The deepest folder the phone may make. */
export const MAX_DEPTH = 8;

export type DriveSpace = 'mine' | 'shared';

export const DRIVE_SPACES: readonly DriveSpace[] = ['mine', 'shared'];

/** Who is asking: established by `withNativeAccess('drive', …)`, never by the request. */
export type AppDriveCaller =
  | { kind: 'owner'; email: string }
  | { kind: 'member'; email: string; principalId: string };

/** One space, resolved for one caller: whose rows it holds and the stored-name prefix they share. */
export interface SpaceScope {
  space: DriveSpace;
  principal: string;
  /** '' for the owner's own drive; otherwise `members/<principal>/`. */
  root: string;
}

/** A member principal as Main mints them (`u_` + base36). Anything else is not a person's folder. */
const MEMBER_PRINCIPAL = /^u_[a-z0-9]{4,40}$/;

export function parseSpace(raw: string | null | undefined): DriveSpace | null {
  return raw === 'mine' || raw === 'shared' ? raw : null;
}

/**
 * The scope of one of the caller's spaces, or null when it has none — a member
 * whose principal is not a real member id ('owner', 'household', or anything
 * odd) gets no "mine" rather than somebody else's.
 */
export function spaceScope(caller: AppDriveCaller, space: DriveSpace): SpaceScope | null {
  if (space === 'shared') {
    return { space, principal: HOUSEHOLD_PRINCIPAL, root: `${MEMBER_ROOT}${HOUSEHOLD_PRINCIPAL}/` };
  }
  if (caller.kind === 'owner') return { space, principal: OWNER_PRINCIPAL, root: '' };
  if (!MEMBER_PRINCIPAL.test(caller.principalId)) return null;
  return { space, principal: caller.principalId, root: `${MEMBER_ROOT}${caller.principalId}/` };
}

/** True when a stored name with this principal lies inside the scope. */
export function inScope(row: { name: string; principalId: string }, scope: SpaceScope): boolean {
  if (row.principalId !== scope.principal) return false;
  if (scope.root === '') return !row.name.startsWith(MEMBER_ROOT);
  return row.name.startsWith(scope.root) && row.name.length > scope.root.length;
}

/**
 * Which of the caller's spaces a row is in, or null when it is in neither —
 * the gate on every by-id request. Null is answered as "no such file": a file
 * somebody else may not see does not exist for them.
 */
export function rowScope(row: { name: string; principalId: string }, caller: AppDriveCaller): SpaceScope | null {
  for (const space of DRIVE_SPACES) {
    const scope = spaceScope(caller, space);
    if (scope && inScope(row, scope)) return scope;
  }
  return null;
}

/** The row's name as the phone sees it, relative to its space. */
export function viewName(stored: string, scope: SpaceScope): string {
  return scope.root ? stored.slice(scope.root.length) : stored;
}

/** True for a character no name may hold: controls, NUL, and the path separators. */
function hasForbidden(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f\\]/.test(s);
}

function segmentOk(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment.length <= MAX_SEGMENT &&
    segment !== '.' &&
    segment !== '..' &&
    segment.trim() === segment &&
    !hasForbidden(segment)
  );
}

/**
 * A folder path as the phone sends it — '' for the space's top, else `a/b` —
 * or null when it is not one. Refused, never repaired: a path that tries to
 * climb out (`..`), names nothing (`a//b`) or hides a separator is an attack or
 * a bug, and neither should be quietly turned into something that works.
 */
export function cleanFolder(raw: string | null | undefined): string | null {
  const value = (raw ?? '').replace(/^\/+|\/+$/g, '');
  if (value === '') return '';
  const segments = value.split('/');
  if (segments.length > MAX_DEPTH) return null;
  return segments.every(segmentOk) && !segments.includes(FOLDER_MARKER) ? value : null;
}

/** A single file or folder name: no separator, no marker, no traversal. Null when unusable. */
export function cleanName(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (value.includes('/') || value === FOLDER_MARKER) return null;
  return segmentOk(value) ? value : null;
}

/**
 * The stored name for `name` in `folder` of a scope, or null when the result
 * would be too long or would land outside the scope's principal — the
 * invariant every writer keeps: principal_id === principalForName(name).
 */
export function storedName(scope: SpaceScope, folder: string, name: string): string | null {
  const stored = `${scope.root}${folder ? `${folder}/` : ''}${name}`;
  if (stored.length > MAX_STORED_NAME) return null;
  if (principalForName(stored) !== scope.principal) return null;
  if (scope.root === '' && stored.startsWith(MEMBER_ROOT)) return null;
  return stored;
}

/**
 * May the caller delete this row, already known to be in `scope`? In their own
 * space, always. In the shared folder only what they put there — the family's
 * folder must not be one person's to empty — except the owner, who may tidy it.
 */
export function mayDelete(
  row: { uploadedBy: string | null },
  scope: SpaceScope,
  caller: AppDriveCaller,
): boolean {
  if (scope.space === 'mine') return true;
  if (caller.kind === 'owner') return true;
  return !!row.uploadedBy && row.uploadedBy.trim().toLowerCase() === caller.email.trim().toLowerCase();
}

/** `photo.jpg` → `photo (2).jpg`; a name without an extension gets the suffix at the end. */
export function withSuffix(name: string, n: number): string {
  if (n <= 1) return name;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name} (${n})`;
  return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
}

export interface ListedFolder {
  name: string;
  /** Relative to the space, as the phone sends it back. */
  path: string;
  /** Files anywhere beneath it (markers not counted). */
  items: number;
}

export interface ListingRow {
  name: string;
}

/**
 * One folder's contents from all of a space's rows (already scoped): the
 * subfolders directly inside it, and the files directly inside it. Folders are
 * virtual — derived from `/` in names, plus `.keep` markers for empty ones —
 * exactly as /drive draws them.
 */
export function listFolder<T extends ListingRow>(
  rows: readonly T[],
  scope: SpaceScope,
  folder: string,
): { folders: ListedFolder[]; files: T[] } {
  const prefix = folder ? `${folder}/` : '';
  const folders = new Map<string, number>();
  const files: T[] = [];
  for (const row of rows) {
    const view = viewName(row.name, scope);
    if (!view.startsWith(prefix)) continue;
    const rest = view.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf('/');
    if (slash < 0) {
      if (rest !== FOLDER_MARKER) files.push(row);
      continue;
    }
    const child = rest.slice(0, slash);
    folders.set(child, (folders.get(child) ?? 0) + (rest.endsWith(`/${FOLDER_MARKER}`) ? 0 : 1));
  }
  return {
    folders: [...folders.entries()]
      .map(([name, items]) => ({ name, path: `${prefix}${name}`, items }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
    files: files.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
  };
}

/** True when the row is in `folder` or anywhere below it (folder relative to the scope). */
export function underFolder(row: ListingRow, scope: SpaceScope, folder: string): boolean {
  if (!folder) return false;
  return viewName(row.name, scope).startsWith(`${folder}/`);
}
