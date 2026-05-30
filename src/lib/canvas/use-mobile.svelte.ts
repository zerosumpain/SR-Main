const MOBILE_BREAKPOINT = '(max-width: 768px)';

/**
 * Returns a getter for an SSR-safe reactive boolean that's true when
 * the viewport matches the mobile breakpoint. Updates on resize /
 * orientation change.
 *
 * Usage:
 *   const getIsMobile = useIsMobile();
 *   let isMobile = $derived(getIsMobile());
 */
export function useIsMobile(): () => boolean {
  let isMobile = $state(false);
  if (typeof window === 'undefined') return () => false;

  const mq = window.matchMedia(MOBILE_BREAKPOINT);
  isMobile = mq.matches;
  const onChange = (e: MediaQueryListEvent) => {
    isMobile = e.matches;
  };
  mq.addEventListener('change', onChange);
  // No teardown — the canvas page lives for the whole route and the listener
  // is GC'd when the page unmounts. Add an explicit teardown if used from a
  // longer-lived consumer.
  return () => isMobile;
}
