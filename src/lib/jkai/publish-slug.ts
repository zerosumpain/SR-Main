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
 */
export function resolvePublishSlug(
  build: { id: string; title: string | null; prompt?: string },
  requested: string,
): { ok: true; slug: string } | { ok: false; error: string } {
  if (requested) {
    const clean = slugifyTitle(requested);
    if (!clean) {
      return {
        ok: false,
        error: `slug "${requested}" has no usable characters (a-z, 0-9 and dashes only)`,
      };
    }
    return { ok: true, slug: clean };
  }
  const derived = build.title
    ? slugifyTitle(build.title)
    : slugifyTitle((build.prompt ?? '').slice(0, 60));
  return { ok: true, slug: derived || build.id.slice(0, 8) };
}
