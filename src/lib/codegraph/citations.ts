/**
 * Resolving the file references a memory note ACTUALLY contains.
 *
 * A lesson reaches a build through `codegraph_node_lessons`, and that table is
 * populated from the note's cited paths. Ingest used to recognise one form of
 * citation — a full repo-relative path, `src/lib/…` — and 117 of 277 notes
 * contain not one. Those notes are linked to zero nodes, which means no file
 * seed can ever reach them: `project_connector_health` and
 * `project_credential_modal` are invisible to a build touching connectors or
 * credentials, which are precisely the builds they were written for.
 *
 * They are not vague. They say `$lib/connectors/`, `monitor.ts`,
 * `/admin/connections/gmail` — every one of which resolves to an exact file
 * against the tracked tree. This module does that resolution, and only that:
 * four mechanical lanes, no inference, no model.
 *
 * CONSERVATISM IS THE WHOLE DESIGN. A citation is a claim that this note is
 * about this file, and a wrong one puts an authoritative-sounding note in front
 * of an agent editing something unrelated. Every lane below resolves to exactly
 * one file or declines. That is the same rule `pickNamedFiles` already applies
 * to task text — `orchestrator.ts` hits 1 of 3,170 nodes and is taken,
 * `types.ts` hits 39 and is not.
 */
import { bareNamesInText, dirHintsInText, pathsInText, pickNamedFiles } from './build-context';

/** Top-level directories that belong to this repo's graph. */
const REPO_TOP_DIR = /^(src|scripts|packages|static|docs|tests|field-study-system|\.github)\//;

/** Extensions tried when a `$lib` reference omits one, longest-lived first. */
const EXTS = ['.ts', '.js', '.svelte', '.mjs', '.svelte.ts', '.json'];
const INDEXES = ['/index.ts', '/index.js', '/index.svelte'];

/**
 * A `$lib/...` reference, with or without an extension, and with or without a
 * trailing slash. Written constantly in these notes because that is how the
 * code itself imports.
 */
const LIB_REF = /\$lib\/([A-Za-z0-9_\-./[\]]*)/g;

/**
 * A site path: `/admin/connections/gmail`, `/jkai/canvas`, `/api/jkai/builds`.
 * Requires two segments — a bare `/admin` is written in prose far too loosely
 * to be evidence of anything, and `/` alone would match every URL on the page.
 */
const ROUTE_REF = /(?:^|[\s`'"(])(\/(?:admin|jkai|api|projects|blog)\/[a-z0-9\-/[\]_.]*[a-z0-9\]])/gi;

/**
 * How many files a directory may hold before a reference to the directory
 * stops being a reference to its contents.
 *
 * `$lib/connectors/` is four files and naming it clearly means all four.
 * `$lib/components/` is hundreds and means none of them in particular — citing
 * those would attach one note to a tenth of the repo and make every query that
 * touches a component return it.
 */
const MAX_DIR_FILES = 6;

/** Everything under `dir` (one level or deeper), for the small-directory lane. */
function filesUnder(dir: string, tracked: Set<string>): string[] {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  const out: string[] = [];
  for (const p of tracked) {
    if (p.startsWith(prefix)) out.push(p);
    if (out.length > MAX_DIR_FILES) break;
  }
  return out;
}

/** Resolve one `$lib/...` body to a tracked file, or null. */
function resolveLibRef(body: string, tracked: Set<string>): string[] {
  const clean = body.replace(/[.,;:)\]`'"]+$/, '');
  if (!clean) return [];
  const base = `src/lib/${clean.replace(/\/$/, '')}`;

  if (tracked.has(base)) return [base];
  for (const e of EXTS) if (tracked.has(base + e)) return [base + e];
  for (const i of INDEXES) if (tracked.has(base + i)) return [base + i];

  // A directory: cite its contents only while "the directory" and "its files"
  // still mean the same thing.
  const under = filesUnder(base, tracked);
  if (under.length && under.length <= MAX_DIR_FILES) return under;
  return [];
}

/**
 * Resolve a site path to the route file that serves it.
 *
 * `+page.svelte` before `+page.server.ts` because a note about a screen is
 * usually about what is on it, and `+server.ts` for `/api/...` where there is
 * no page at all.
 */
function resolveRouteRef(route: string, tracked: Set<string>): string[] {
  const rel = route.replace(/^\//, '').replace(/\/$/, '');
  if (!rel) return [];
  const dir = `src/routes/${rel}`;
  for (const leaf of ['+page.svelte', '+page.server.ts', '+server.ts', '+layout.svelte']) {
    if (tracked.has(`${dir}/${leaf}`)) return [`${dir}/${leaf}`];
  }
  return [];
}

/**
 * Every file a note can be shown to be about.
 *
 * `tracked` is the repo's file list — `git ls-files` at the ingesting machine's
 * HEAD. Resolving against the tree rather than against the node table is
 * deliberate: the node table contains deleted files, and a citation minted
 * against one is stale the moment it is written.
 */
export function resolveCitations(text: string, tracked: Iterable<string>, max = 40): string[] {
  const set = tracked instanceof Set ? tracked : new Set(tracked);
  const out = new Set<string>();
  const take = (p: string) => {
    if (out.size < max && REPO_TOP_DIR.test(p) && set.has(p)) out.add(p);
  };

  // 1. Full repo-relative paths — the lane that already existed.
  for (const p of pathsInText(text, max)) take(p);

  // 2. `$lib/...` aliases, including small directories.
  for (const m of text.matchAll(LIB_REF)) {
    for (const p of resolveLibRef(m[1], set)) take(p);
  }

  // 3. Site paths.
  for (const m of text.matchAll(ROUTE_REF)) {
    for (const p of resolveRouteRef(m[1], set)) take(p);
  }

  // 4. Bare filenames, disambiguated by any directory the note itself names.
  //    Reuses the task-text resolver rather than growing a second copy of the
  //    exactly-one-match rule, which is the part that has to stay identical.
  const dirHints = dirHintsInText(text, 12);
  const named = pickNamedFiles(bareNamesInText(text, 24), dirHints, [...set]);
  for (const p of named.resolved) take(p);

  return [...out];
}
