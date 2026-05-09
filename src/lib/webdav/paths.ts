// Translation between the URL space the WebDAV client sees (`/dav/<rel>`)
// and the internal `workflow_files.name` space (`drive/<rel>`). The drive/
// prefix is invisible to the client; everything inside `drive/` becomes
// the user's mount root.

const DRIVE_PREFIX = 'drive/';
const FOLDER_MARKER = '.keep';

// Strip query/fragment, decode URI components, drop leading slash. The
// result is the path *under* `/dav/`. Trailing slashes are preserved as a
// signal that the client is talking about a collection.
export function urlToRel(pathname: string): { rel: string; isCollection: boolean } {
  const m = pathname.match(/^\/dav(\/.*)?$/);
  if (!m) throw new Error(`not a /dav path: ${pathname}`);
  let rel = (m[1] ?? '').replace(/^\/+/, '');
  const isCollection = rel === '' || rel.endsWith('/');
  rel = rel.replace(/\/+$/, '');
  // %20 → space, %23 → #, etc.
  rel = decodeURIComponent(rel);
  return { rel, isCollection };
}

// `<rel>` (e.g. "reports/q1.csv") → `drive/reports/q1.csv` (workflow_files.name).
// Empty rel → "drive" (the root collection itself, not normally stored).
export function relToName(rel: string): string {
  if (!rel) return DRIVE_PREFIX.replace(/\/$/, '');
  return DRIVE_PREFIX + rel;
}

// Reverse — strip the `drive/` prefix back off a row.name. Returns null if
// the row is not under the drive prefix (defensive — shouldn't happen).
export function nameToRel(name: string): string | null {
  if (name === DRIVE_PREFIX.replace(/\/$/, '')) return '';
  if (!name.startsWith(DRIVE_PREFIX)) return null;
  return name.slice(DRIVE_PREFIX.length);
}

// Folder marker key used to materialise empty folders so they survive
// PROPFIND. MKCOL inserts one of these; PROPFIND filters them out of
// listings (they back the folder's existence, they don't appear as files).
export function folderMarkerName(rel: string): string {
  const dir = rel.replace(/\/$/, '');
  return relToName(dir ? `${dir}/${FOLDER_MARKER}` : FOLDER_MARKER);
}

export function isFolderMarker(name: string): boolean {
  return name === FOLDER_MARKER || name.endsWith(`/${FOLDER_MARKER}`);
}

// Given `rel` of a collection, the SQL LIKE pattern matching descendants.
// Pair with `ESCAPE '\\'` in the query — user-controlled segments of the
// path are escaped here so a `%` or `_` in a folder name is treated as a
// literal. The trailing `%` wildcard is intentionally unescaped.
export function descendantPattern(rel: string): string {
  const escape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  if (!rel) return `${DRIVE_PREFIX}%`;
  return `${escape(relToName(rel))}/%`;
}

// Build the URL path for a relative entry inside the mount, properly
// percent-encoded. Used in PROPFIND href fields.
export function relToHref(rel: string, isCollection: boolean): string {
  const segs = rel.split('/').filter(Boolean).map(encodeURIComponent);
  const path = segs.length === 0 ? '/dav/' : '/dav/' + segs.join('/');
  return isCollection && !path.endsWith('/') ? path + '/' : path;
}

export { DRIVE_PREFIX, FOLDER_MARKER };
