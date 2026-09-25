// The one mapping from a library "not found" to a route's 404.
//
// Scoped library functions (merge, unmerge, split, undo, a recorded or cleared
// verdict, a confirmed link) treat an id outside the reader's scope exactly as
// an id that does not exist, and THROW — they run unattended too, where there is
// no response to shape. A route that turned that into a 400 or a 500 would tell
// a member "this id exists, you just cannot touch it", which is the disclosure
// spaces exist to prevent, so every by-id route maps it to 404 through here.
import { error } from '@sveltejs/kit';

const NOT_FOUND = /\bnot found\b|\bno such (entity|split)\b/i;

/** True for the error a scoped library function throws on an unknown or out-of-scope id. */
export function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && NOT_FOUND.test(err.message);
}

/**
 * Rethrow a library failure as an HTTP error: 404 for "not found / out of
 * scope", `status` (the route's existing code, usually 400) for anything else.
 *
 * A 500 is a server fault, not a bad request, so its text is not the caller's
 * business: the original error is rethrown untouched and SvelteKit answers with
 * its generic "Internal Error" (the message still reaches the server log), as
 * these routes did before they were scoped.
 */
export function rethrowScoped(err: unknown, status: 400 | 409 | 500, fallback: string): never {
  if (isNotFoundError(err)) throw error(404, (err as Error).message);
  if (status === 500) throw err;
  const message = err instanceof Error ? err.message : fallback;
  throw error(status, message);
}
