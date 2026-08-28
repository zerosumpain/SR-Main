// `jkai_builds.published_slug` is a union wearing one column, and the UI used
// to read it as though it were only ever the first member.
//
// Three shapes reach it in production:
//
//   stopwatch                                        an app build's /projects slug
//   https://github.com/zerosumpain/SR-Main/pull/416   a git-target build's PR
//   master...agent/ab2-a15e73d3                       a git-target build with openPr: false
//
// Seven components built `/projects/${publishedSlug}/` from all three, so a
// change-request build's "Live" button pointed at
// `/projects/https://github.com/zerosumpain/SR-Main/pull/416/` and 404'd
// (reported 2026-08-23). The branch-ref form failed the same way, more quietly,
// on four Forge builds.
//
// The compare ref deliberately carries no host — `publishViaGit` writes
// `${baseBranch}...${branch}` and the repo differs per build (SR-Main for change
// requests, the game repo for the Forge). So there is no honest URL to build
// from it here, and this returns no link rather than inventing one.

/** A /projects address: one lowercase URL segment, as `slugifyTitle` produces.
 *  Mirrors PROJECT_SLUG in $lib/projects/visibility — kept local so this stays
 *  importable from a component without dragging the visibility module in. */
const PROJECT_SLUG = /^[a-z0-9][a-z0-9-]*$/;

export interface PublishedLink {
  href: string;
  /** Link text: what the destination actually is. */
  label: string;
  /** True when the destination is off-site (a PR), so it wants target=_blank
   *  and must never be offered an "Unpublish" button — there is nothing on this
   *  site to unpublish. */
  external: boolean;
}

/**
 * Resolve `published_slug` to a link, or null when it does not name one.
 *
 * Fails closed: an unrecognised value produces no link at all. A dead link that
 * looks alive is worse than an absent one — that is the whole of this bug.
 */
export function publishedLink(slug: string | null | undefined): PublishedLink | null {
  const value = typeof slug === 'string' ? slug.trim() : '';
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    return { href: value, label: 'Pull request', external: true };
  }
  if (PROJECT_SLUG.test(value)) {
    return { href: `/projects/${value}/`, label: 'Live', external: false };
  }
  return null;
}

/**
 * What to show when there is no link — the raw value still identifies the
 * branch, so it is worth rendering as text.
 */
export function publishedLabel(slug: string | null | undefined): string | null {
  const value = typeof slug === 'string' ? slug.trim() : '';
  return value || null;
}
