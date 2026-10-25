/**
 * Where a build lands when it is published.
 *
 * Shared by the two callers that must never disagree: the Publish button
 * (`/api/jkai/builds/[id]/publish`) and the `build_control` site tool. It lives
 * here rather than beside either of them so importing it does not drag in the
 * tool registry or the sandbox.
 */

/** Slug form of a title: lowercase, dash-separated, trimmed, 60 chars. */
export function slugifyTitle(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * The caller's slug if they named one, else the build's own title, else its id.
 *
 * Deriving is what made "republish over the same page" impossible to express:
 * a rewritten app is a new build row with a new title, so it landed at a new
 * address while the broken page stayed up. That is precisely what happened on
 * 2026-08-08 — the fixed calculator would have gone to /projects/graphing-calculator/
 * while /projects/simple-calculator/ carried on answering 0 to every sum.
 *
 * `isReserved` names the hand-deployed static keys (pass
 * `isStaticProjectKey` from `$lib/projects/visibility`). It is a parameter, not
 * an import, because `$lib/projects` already imports `$lib/jkai`; importing
 * back would make the two modules a cycle.
 */
export function resolvePublishSlug(
  build: { id: string; title: string | null; prompt?: string },
  requested: string,
  isReserved: (slug: string) => boolean,
): { ok: true; slug: string } | { ok: false; error: string } {
  if (requested) {
    const clean = slugifyTitle(requested);
    if (!clean) {
      return {
        ok: false,
        error: `slug "${requested}" has no usable characters (a-z, 0-9 and dashes only)`,
      };
    }
    if (isReserved(clean)) {
      return {
        ok: false,
        error: `slug "${clean}" belongs to a hand-deployed page (STATIC_PROJECT_KEYS); a build cannot publish over it`,
      };
    }
    return { ok: true, slug: clean };
  }
  const derived =
    (build.title ? slugifyTitle(build.title) : slugifyTitle((build.prompt ?? '').slice(0, 60))) ||
    build.id.slice(0, 8);
  // A static key's folder is hand-deployed (Hometowns keeps one folder per
  // page hash there), and publishBuild empties the destination and rsyncs
  // it with --delete. A build titled "Hometowns" must land beside it instead,
  // suffixed the same way the publish route suffixes a derived collision.
  if (isReserved(derived)) return { ok: true, slug: `${derived}-${build.id.slice(0, 6)}` };
  return { ok: true, slug: derived };
}
