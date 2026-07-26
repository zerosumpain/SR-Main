// Shared state for the JKAI command palette (⌘/Ctrl-K).
//
// The palette panel itself lives in /jkai/+layout.svelte so every page under
// /jkai gets it, but the *trigger* belongs wherever the page has room. Pages
// with a composer (chat) dock their own trigger next to Send; the layout's
// floating fallback button then stands down, because bottom-left is where the
// conversation sidebar's run-stats footer lives and the two collided.
//
// `dockedTriggers` is a count, not a boolean, so overlapping mounts during a
// route transition can't leave the layout button permanently hidden.
export const launcher = $state({ open: false, dockedTriggers: 0 });

export function openLauncher(): void {
  launcher.open = true;
}

export function closeLauncher(): void {
  launcher.open = false;
}

export function toggleLauncher(): void {
  launcher.open = !launcher.open;
}

/**
 * Declare that this page renders its own palette trigger. Call from `onMount`
 * and invoke the returned function on teardown.
 */
export function dockTrigger(): () => void {
  launcher.dockedTriggers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    launcher.dockedTriggers -= 1;
  };
}
