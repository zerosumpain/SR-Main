// Pure visibility logic for /projects. A project is public unless an explicit
// row marks it private — absence of a row always means public, so the feature
// is inert until something is toggled.

export interface VisibilityRow {
  projectKey: string;
  isPublic: boolean;
}

export type VisibilityMap = Record<string, boolean>;

/** Collapse DB rows into a `key -> isPublic` lookup. */
export function resolveVisibilityMap(rows: VisibilityRow[]): VisibilityMap {
  const map: VisibilityMap = {};
  for (const row of rows) map[row.projectKey] = row.isPublic;
  return map;
}

/** A project is public unless an explicit row marks it private. */
export function isProjectPublic(map: VisibilityMap, key: string): boolean {
  return map[key] ?? true;
}

/** Authed viewers see everything; the public sees only public projects. */
export function filterForViewer<T extends { key: string }>(
  items: T[],
  map: VisibilityMap,
  authed: boolean,
): T[] {
  if (authed) return items;
  return items.filter((item) => isProjectPublic(map, item.key));
}
