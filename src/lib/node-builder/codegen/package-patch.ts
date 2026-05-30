import type { NodeSpec, NodeDep } from '../spec/types';

/**
 * Idempotently adds entries from `spec.deps` to a package.json source's
 * `dependencies` map. Returns the updated source as a formatted JSON string.
 *
 * - If the dep is already present at any version, leaves it alone (no
 *   overwrite — avoids surprise version churn).
 * - Preserves the rest of the package.json untouched: same key ordering,
 *   same trailing-newline policy as the input.
 * - If `dependencies` is missing, adds it after `version`.
 *
 * Returns the original source unchanged when spec.deps is empty.
 *
 * Pure function — does not touch the filesystem.
 */
export function patchPackageJson(source: string, spec: NodeSpec): string {
  if (!spec.deps || spec.deps.length === 0) return source;

  const trailingNewline = source.endsWith('\n');
  const pkg = JSON.parse(source) as PackageJsonLike;

  const deps = pkg.dependencies ?? {};
  let changed = false;

  for (const dep of spec.deps) {
    if (!isValidDep(dep)) continue;
    if (deps[dep.name]) continue; // leave existing pinned versions alone
    deps[dep.name] = dep.version;
    changed = true;
  }

  if (!changed) return source;

  pkg.dependencies = sortObjectKeys(deps);

  return JSON.stringify(pkg, null, 2) + (trailingNewline ? '\n' : '');
}

interface PackageJsonLike {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

function isValidDep(dep: NodeDep): boolean {
  return (
    typeof dep.name === 'string' &&
    dep.name.length > 0 &&
    typeof dep.version === 'string' &&
    dep.version.length > 0
  );
}

function sortObjectKeys<T extends Record<string, string>>(obj: T): T {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted as T;
}
