import { page } from '$app/state';

/**
 * Whether the viewer is a family member rather than the owner, for a shared
 * intel component that is not handed the page's `data`.
 *
 * Read from the `member` flag the /jkai and /jkai/intel layouts return.
 * Anything else — no flag, or no router context at all, where `page` throws —
 * answers false, so a component rendered outside /jkai/intel (the chat hover
 * card, a test harness) keeps its owner behaviour. The server gate is the real
 * boundary; this only stops a member's browser offering or calling what that
 * gate would refuse.
 *
 * Not in `$lib/nav/page-path`: that file is vendored byte for byte into the
 * extracted apps (shared-with-extracted.json), and this question is intel's.
 */
export function currentIsMember(): boolean {
  try {
    return page.data?.member === true;
  } catch {
    return false;
  }
}
