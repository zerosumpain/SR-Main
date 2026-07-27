// Which Drive files feed the intel graph, and under which categories.
//
// Drive folders are virtual — a "folder" is just a `/`-separated prefix of
// `workflow_files.name`. Settings therefore hang off the path string
// (`drive_folder_settings`) and have to be RESOLVED by walking ancestors, which
// is what this module does. It is deliberately pure and DB-free so the /drive
// UI can preview the effective policy for a folder without a round trip, and so
// the rules are unit-testable (see tests/lib/jkai/intel-source-policy.test.ts).
//
// Two different inheritance rules, because the two settings mean different things:
//
//   mode        — the NEAREST ancestor with an explicit mode wins. Excluding
//                 `clients/` and then re-including `clients/acme/` has to work,
//                 which a union cannot express.
//   categories  — the UNION of every ancestor's categories. A label put on
//                 `clients/` is true of everything inside it; requiring it to be
//                 repeated on each subfolder would make labelling useless.

export type IntelMode = 'inherit' | 'include' | 'exclude';

export const INTEL_MODES: IntelMode[] = ['inherit', 'include', 'exclude'];

export interface FolderSetting {
  path: string;
  intelMode: IntelMode;
  categoryIds: string[];
}

export interface ResolvedPolicy {
  /** False when this file/folder must not feed the intel graph. */
  included: boolean;
  /** The folder path whose explicit mode decided it; null when nothing did. */
  decidedBy: string | null;
  /** Category ids, inherited down the tree and de-duplicated. */
  categoryIds: string[];
}

export function isIntelMode(value: unknown): value is IntelMode {
  return typeof value === 'string' && (INTEL_MODES as string[]).includes(value);
}

/**
 * The folder a file name sits in. `'a/b/c.txt'` → `'a/b'`; a root file → `''`.
 */
export function folderOf(fileName: string): string {
  const trimmed = normalisePath(fileName);
  const cut = trimmed.lastIndexOf('/');
  return cut === -1 ? '' : trimmed.slice(0, cut);
}

/** Strip leading/trailing slashes and collapse doubles — paths are compared as strings. */
export function normalisePath(path: string): string {
  return path.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

/**
 * Every ancestor of a folder, ROOT FIRST: `'a/b/c'` → `['', 'a', 'a/b', 'a/b/c']`.
 * The root (`''`) is always included so a setting on it applies to everything.
 */
export function ancestorPaths(folder: string): string[] {
  const clean = normalisePath(folder);
  const out = [''];
  if (!clean) return out;
  const segments = clean.split('/');
  let acc = '';
  for (const segment of segments) {
    acc = acc ? `${acc}/${segment}` : segment;
    out.push(acc);
  }
  return out;
}

/**
 * Resolve the effective policy for a folder against the full settings list.
 *
 * `settings` may contain paths unrelated to this folder — the caller normally
 * passes every row it has, and this picks out the ancestors.
 */
export function resolveFolderPolicy(folder: string, settings: FolderSetting[]): ResolvedPolicy {
  const byPath = new Map<string, FolderSetting>();
  for (const s of settings) byPath.set(normalisePath(s.path), s);

  const chain = ancestorPaths(folder);
  let included = true;
  let decidedBy: string | null = null;
  const categoryIds: string[] = [];
  const seen = new Set<string>();

  // Root-first, so the LAST explicit mode seen is the nearest ancestor's.
  for (const path of chain) {
    const setting = byPath.get(path);
    if (!setting) continue;
    if (setting.intelMode === 'include' || setting.intelMode === 'exclude') {
      included = setting.intelMode === 'include';
      decidedBy = path;
    }
    for (const id of setting.categoryIds ?? []) {
      if (!seen.has(id)) {
        seen.add(id);
        categoryIds.push(id);
      }
    }
  }

  return { included, decidedBy, categoryIds };
}

/** Convenience: the policy that applies to a file, given its full Drive name. */
export function resolveFilePolicy(fileName: string, settings: FolderSetting[]): ResolvedPolicy {
  return resolveFolderPolicy(folderOf(fileName), settings);
}

/** True when `folder` is `ancestor` or sits underneath it. `''` matches everything. */
export function isUnder(folder: string, ancestor: string): boolean {
  const a = normalisePath(ancestor);
  const f = normalisePath(folder);
  if (!a) return true;
  return f === a || f.startsWith(`${a}/`);
}

/** Slugify a category name into the stable key stored on notes. */
export function categorySlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
