/**
 * Virtual-folder maths for /drive.
 *
 * There is no folder table. A folder is the text before a `/` in
 * `workflow_files.name`, and an empty one is held open by a `.keep` marker that
 * the UI never shows. Every function here is pure and string-only, which is the
 * point: moving a file is renaming it, so the same maths decides what the
 * breadcrumbs say, what a folder tile counts, and what a drop is allowed to do.
 *
 * Lifted out of the 2,505-line `+page.svelte` unchanged in behaviour — the
 * tests below are the first time any of it has been asserted.
 */

/** The zero-byte file that keeps an empty folder on screen. Never listed. */
export const FOLDER_MARKER = '.keep';

export interface DriveFileLike {
  id: string;
  name: string;
}

export interface Crumb {
  label: string;
  path: string;
}

export interface Subfolder {
  name: string;
  /** Real files anywhere beneath it — markers excluded. */
  count: number;
}

/** A `.keep` marker, at the root or in any folder. */
export function isMarker(name: string): boolean {
  return name === FOLDER_MARKER || name.endsWith('/' + FOLDER_MARKER);
}

/** `('a/b', 'c.txt')` → `'a/b/c.txt'`; an empty dir is the root. */
export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** The last segment — what the user calls the file. */
export function baseName(name: string): string {
  return name.split('/').pop() || name;
}

/** Everything before the last `/`; `''` for a file at the root. */
export function folderOf(name: string): string {
  const i = name.lastIndexOf('/');
  return i === -1 ? '' : name.slice(0, i);
}

/**
 * The part of `name` below `dir`, or null when it does not live there.
 *
 * `underCurrent('a/b/c.txt', 'a')` → `'b/c.txt'`; a remainder containing a `/`
 * therefore means "in a subfolder", which is how the folder list is derived.
 */
export function underCurrent(name: string, dir: string): string | null {
  if (!dir) return name;
  const prefix = dir + '/';
  return name.startsWith(prefix) ? name.slice(prefix.length) : null;
}

/** Is `path` `ancestor` itself, or anywhere inside it? */
export function isWithin(path: string, ancestor: string): boolean {
  if (!ancestor) return true;
  return path === ancestor || path.startsWith(ancestor + '/');
}

/** `'a/b'` → Drive / a / b. The root crumb is always first. */
export function crumbsFor(currentPath: string): Crumb[] {
  const out: Crumb[] = [{ label: 'Drive', path: '' }];
  let acc = '';
  for (const seg of currentPath ? currentPath.split('/') : []) {
    acc = acc ? `${acc}/${seg}` : seg;
    out.push({ label: seg, path: acc });
  }
  return out;
}

/**
 * Files sitting directly in `dir` — no markers, nothing from a subfolder.
 * `query` matches the base name only, so typing "report" does not surface every
 * file in a folder called `reports`.
 */
export function filesIn<T extends DriveFileLike>(files: T[], dir: string, query = ''): T[] {
  const q = query.trim().toLowerCase();
  return files.filter((f) => {
    if (isMarker(f.name)) return false;
    const rem = underCurrent(f.name, dir);
    if (rem === null || rem.includes('/')) return false;
    return !q || baseName(f.name).toLowerCase().includes(q);
  });
}

/**
 * The immediate subfolders of `dir`, with the real files beneath each.
 *
 * The count is the whole subtree, not just the folder's own level — a folder
 * tile saying "0 items" over three nested folders of invoices would be lying.
 */
export function subfoldersOf(files: DriveFileLike[], dir: string, query = ''): Subfolder[] {
  const q = query.trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const f of files) {
    const rem = underCurrent(f.name, dir);
    if (rem === null) continue;
    const slash = rem.indexOf('/');
    if (slash <= 0) continue;
    const seg = rem.slice(0, slash);
    if (!counts.has(seg)) counts.set(seg, 0);
    if (!isMarker(f.name)) counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .filter(({ name }) => !q || name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every folder path in the store, ancestors included, sorted. */
export function allFolders(files: DriveFileLike[]): string[] {
  const set = new Set<string>();
  for (const f of files) {
    if (!f.name.includes('/')) continue;
    let acc = '';
    for (const seg of folderOf(f.name).split('/')) {
      acc = acc ? `${acc}/${seg}` : seg;
      set.add(acc);
    }
  }
  return [...set].sort();
}
