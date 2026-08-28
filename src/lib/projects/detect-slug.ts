// Work out which /projects address a change-request build added, from the list
// of files its PR touched.
//
// A change-request build that creates a page lands `src/routes/projects/<slug>/
// +page.svelte` in the repo. That page is a real route the moment the PR
// merges, but nothing connects it to the projects index: `published_slug` is
// occupied by the PR url, so `isProjectSlug` filters the build off the index
// and `getAllowedProjectKeys` will not even permit a visibility toggle on it.
// A page could be built and deployed with no way to give it a card.
//
// This is the missing half of that link. It is deliberately pure — GitHub is
// the caller's problem — so the rule about which paths count is unit-testable
// against real PR file lists rather than only in production.

import { isProjectSlug } from './visibility';

/** `src/routes/projects/<slug>/...` — the capture is the address segment. */
const PROJECT_ROUTE = /^src\/routes\/projects\/([^/]+)\//;

/** Files that make a route real. A `+page.server.ts` alone is a loader for a
 *  page that must also exist, and a lone `study.ts` is field-study content, so
 *  neither is evidence on its own — but requiring `+page.svelte` and finding
 *  none would miss a page assembled from a shared component, which is why the
 *  server file counts as a weaker second signal below. */
const PAGE_FILE = /\/\+page\.svelte$/;
const PAGE_SERVER_FILE = /\/\+page\.(server\.)?ts$/;

export interface DetectedSlug {
  slug: string;
  /** Every project address the PR touched, in first-seen order. More than one
   *  means the caller has to choose — the modal shows them rather than picking
   *  silently. */
  candidates: string[];
}

/**
 * The address a PR's file list implies, or null when it implies none.
 *
 * Returns the FIRST candidate as `slug` and the whole set as `candidates`, so a
 * PR touching two project routes offers a choice instead of guessing. Nested
 * segments (`projects/engine-room/turn/routing`) resolve to their top-level
 * address, because that is the key the visibility system uses.
 */
export function detectProjectSlug(paths: readonly string[]): DetectedSlug | null {
  const strong: string[] = [];
  const weak: string[] = [];

  for (const raw of paths) {
    const path = typeof raw === 'string' ? raw.trim() : '';
    const m = PROJECT_ROUTE.exec(path);
    if (!m) continue;
    const slug = m[1];
    // Guard the address itself, not just the path shape: a route directory can
    // be a param segment (`[slug]`) or otherwise unusable as a visibility key.
    if (!isProjectSlug(slug)) continue;
    if (PAGE_FILE.test(path)) {
      if (!strong.includes(slug)) strong.push(slug);
    } else if (PAGE_SERVER_FILE.test(path)) {
      if (!weak.includes(slug)) weak.push(slug);
    }
  }

  // A page file is proof. A server file only counts when nothing else claimed
  // that address, so a PR that edits one page's loader and adds another page
  // does not offer the loader's address first.
  const candidates = [...strong, ...weak.filter((s) => !strong.includes(s))];
  if (candidates.length === 0) return null;
  return { slug: candidates[0], candidates };
}
