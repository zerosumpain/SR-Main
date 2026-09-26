import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SOURCE_FOOTPRINT } from 'virtual:sr-source-footprint';
import { getDeployVersion } from '$lib/server/deploy-version';

type Footprint = typeof SOURCE_FOOTPRINT;
type Repository = Footprint['repositories'][number];
type Category = 'code' | 'documentation' | 'tests';
const CATEGORIES: Category[] = ['code', 'documentation', 'tests'];

/** Private service repository sizes live in a runtime file, outside the public build. */
export function withPrivateFootprint(
  publicFootprint: Footprint,
  sourcePath = process.env.SITE_FOOTPRINT_PATH || join(process.cwd(), 'data/site-footprint.json'),
  mainRevision = getDeployVersion().sha,
): Footprint {
  const snapshot: unknown = JSON.parse(readFileSync(sourcePath, 'utf8'));
  if (!snapshot || typeof snapshot !== 'object' || !('repositories' in snapshot) ||
      !Array.isArray(snapshot.repositories) || snapshot.repositories.length < 7 ||
      !('measuredAt' in snapshot) || typeof snapshot.measuredAt !== 'string') {
    throw new Error('Private site footprint must contain the revision-pinned service repositories');
  }

  // A certified build may be promoted from a PR merge ref. The release stamp
  // names the durable master commit that actually serves this build.
  const repositories: Repository[] = publicFootprint.repositories.map((repository) =>
    repository.id === 'main' && mainRevision
      ? { ...repository, revision: mainRevision }
      : repository,
  );
  const ids = new Set(repositories.map((repository) => repository.id));
  for (const value of snapshot.repositories) {
    if (!value || typeof value !== 'object' ||
        !['id', 'name', 'url', 'role', 'revision', 'measuredAt', 'source'].every(
          (key) => typeof value[key] === 'string',
        ) ||
        !CATEGORIES.every((key) => value[key] &&
          Number.isSafeInteger(value[key].lines) && value[key].lines >= 0 &&
          Number.isSafeInteger(value[key].files) && value[key].files >= 0)) {
      throw new Error('Invalid private site footprint repository');
    }
    if (ids.has(value.id)) throw new Error(`Duplicate private site footprint repository: ${value.id}`);
    ids.add(value.id);
    repositories.push(value as Repository);
  }

  const categories = {
    code: { lines: 0, files: 0 },
    documentation: { lines: 0, files: 0 },
    tests: { lines: 0, files: 0 },
  };
  for (const repository of repositories) {
    for (const category of CATEGORIES) {
      categories[category].lines += repository[category].lines;
      categories[category].files += repository[category].files;
    }
  }
  return {
    ...publicFootprint,
    lines: categories.code.lines,
    files: categories.code.files,
    categories,
    repositories,
    snapshotAt: snapshot.measuredAt,
  };
}
