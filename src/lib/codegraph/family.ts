/**
 * What KIND of file this is — the relation the graph was missing.
 *
 * `imports`, `tests` and `co_change` all say how two files relate. None of them
 * says "these 358 files are all route handlers", which is the relation a build
 * needs when it is about to write the 359th. The system prompt already tells the
 * agent to "read two existing files of the same shape"; this is the definition
 * of shape.
 *
 * A NODE ATTRIBUTE, NOT AN EDGE KIND
 *
 * Sibling-of is symmetric and total within a family, so as edges it is
 * quadratic: 358 route handlers is 63,903 rows, 293 test files another 42,778 —
 * against the 6,681 `imports` edges the whole graph holds today. As an attribute
 * it is one text column, computed once per node, and "the siblings of X" is an
 * index lookup rather than a walk.
 *
 * PURE FUNCTION OF THE PATH
 *
 * No file contents, no LLM, no database. That is what lets the same rules run in
 * the ingest route, in the CI tree pass (plain node, no TS build) and in a test,
 * without three implementations drifting apart. The families are the ones this
 * repo actually has — each was checked against `git ls-files` and each holds
 * enough members to make "the canonical one" a meaningful question.
 */

/** Families in match order: the first pattern that fits wins. */
const RULES: Array<{ family: string; test: RegExp }> = [
  // Routes. `+server.ts` under /api is a different animal from one beside a
  // page, and a build writing an endpoint should not be shown a page's loader.
  { family: 'api-endpoint', test: /^src\/routes\/api\/.*\/\+server\.ts$/ },
  { family: 'route-endpoint', test: /^src\/routes\/.*\/\+server\.ts$/ },
  { family: 'page-server', test: /^src\/routes\/.*\/\+page\.server\.ts$/ },
  { family: 'layout-server', test: /^src\/routes\/.*\/\+layout\.server\.ts$/ },
  { family: 'page', test: /^src\/routes\/.*\/\+page\.svelte$/ },
  { family: 'layout', test: /^src\/routes\/.*\/\+layout\.svelte$/ },

  // Tests come before every library rule: `foo.test.ts` is a test first and a
  // module second, and showing a build a test when it is writing a module (or
  // the reverse) is the most obvious way to get the shape wrong.
  { family: 'test', test: /\.(test|spec)\.[tj]sx?$/ },

  // Workflow surfaces. `.def.ts` is the definition, the sibling file is the
  // runtime — two different shapes that live next to each other.
  { family: 'workflow-node-def', test: /^src\/lib\/workflows\/nodes\/.*\.def\.ts$/ },
  { family: 'workflow-node', test: /^src\/lib\/workflows\/nodes\/[^/]+\.ts$/ },
  { family: 'site-tool', test: /^src\/lib\/workflows\/site-tools\/tools\/[^/]+\.ts$/ },

  /*
   * Ambient type declarations are a shape of their own, and must be named
   * BEFORE `lib-module`: `route-manifest.d.ts` ends in `.ts`, so it matched
   * `^src/lib/.*\.ts$` and was filed as an ordinary module.
   */
  { family: 'types', test: /\.d\.ts$/ },

  /*
   * A project page's own helper modules.
   *
   * The single largest gap in family coverage, measured: of 254 family-less
   * files under `src/`, about 166 are `src/routes/projects/<slug>/lib/*.ts` —
   * policy-engine 40, engine-room 29, dfe-data-strategy 26, broads-pilot 18,
   * and so on. They fell through because `lib-module` is scoped to `src/lib/`.
   *
   * They are a genuine family rather than a convenience bucket: someone writing
   * a new field study's `lib/` module wants to see how other field studies
   * wrote theirs, and emphatically does not want `src/lib/jkai/orchestrator.ts`
   * held up as the precedent. Without a family they had no siblings at all, so
   * the precedent channel could not answer for them.
   */
  { family: 'project-lib', test: /^src\/routes\/projects\/[^/]+\/lib\/.*\.[tj]s$/ },

  { family: 'component', test: /^src\/lib\/components\/.*\.svelte$/ },
  { family: 'svelte', test: /\.svelte$/ },
  { family: 'db-schema', test: /^src\/lib\/db\/.*\.ts$/ },
  { family: 'lib-module', test: /^src\/lib\/.*\.ts$/ },
  { family: 'script', test: /^scripts\/.*\.(mjs|js|ts|sh)$/ },
];

/**
 * The family a path belongs to, or null when it belongs to none we can name.
 *
 * Null is a real answer and must stay one: a file with no family has no
 * siblings, and inventing a catch-all ("other") would make every unclassified
 * file a candidate precedent for every other unclassified file.
 */
export function familyOf(path: string | null | undefined): string | null {
  if (!path) return null;
  const p = String(path).trim().replace(/^\.\//, '');
  if (!p || p.includes('..')) return null;
  for (const rule of RULES) {
    if (rule.test.test(p)) return rule.family;
  }
  return null;
}

/** The directory a path sits in, with its trailing slash. `''` at the root. */
export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i + 1);
}

/**
 * How good a precedent is `candidate` for someone writing `target`?
 *
 * Higher is better; the caller sorts. The order of these terms is the whole
 * ranking, so it is worth being explicit about why:
 *
 * 1. SAME DIRECTORY dominates everything. Conventions in this repo are local —
 *    the endpoints under `src/routes/api/jkai/` share an auth guard the ones
 *    under `src/routes/api/public/` must not copy.
 * 2. SHARED PATH DEPTH, so `api/jkai/builds/` beats `api/trails/` for a file
 *    under `api/jkai/`, without needing a rule per subtree.
 * 3. IMPORT IN-DEGREE. A file that many others import is the one that set the
 *    convention; a leaf that nobody imports may be the exception nobody copied.
 * 4. RECORDED HISTORY, faintly. A file with episodes and lessons is one this
 *    codebase has actually reasoned about. It breaks ties; it does not lead,
 *    because "has been fixed a lot" is not obviously a recommendation.
 */
export function siblingScore(
  target: string,
  candidate: { path: string; inDegree: number; episodes: number; lessons: number },
): number {
  if (candidate.path === target) return -Infinity;

  const tDir = dirOf(target);
  const cDir = dirOf(candidate.path);

  let score = 0;
  if (tDir && tDir === cDir) score += 1000;

  const t = tDir.split('/').filter(Boolean);
  const c = cDir.split('/').filter(Boolean);
  let shared = 0;
  while (shared < t.length && shared < c.length && t[shared] === c[shared]) shared++;
  score += shared * 40;

  // Diminishing: the difference between 0 and 5 importers is real, between 40
  // and 60 it is noise, and without a cap `schema.ts` would win every contest
  // it entered.
  score += Math.min(120, Math.round(Math.log2(1 + candidate.inDegree) * 30));
  score += Math.min(20, candidate.episodes * 4 + candidate.lessons * 2);

  return score;
}
