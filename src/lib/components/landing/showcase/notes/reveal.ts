// reveal.ts — the notebook's "seen at last" switch for drawings that ink
// themselves in when they first scroll into view.
//
//   <figure use:reveal> … </figure>
//
// On the server, without JavaScript and under prefers-reduced-motion nothing
// is set, so every mark shows as drawn. Live, the element gets data-armed at
// once (CSS takes the marks back to blank) and data-seen the first time
// enough of it shows (CSS draws them in). Only opacity, transform and
// stroke-dashoffset are ever animated off these. A drawing already in view
// when the page hydrates (or scrolled past) is left drawn, never blanked in
// front of the reader.
import { belowFold, firstView, prefersReducedMotion } from '$lib/landing/showcase-motion';

export function reveal(node: Element): { destroy(): void } {
  if (prefersReducedMotion() || !belowFold(node)) return { destroy() {} };
  node.setAttribute('data-armed', '');
  const seen = firstView(node, () => node.setAttribute('data-seen', ''));
  return { destroy: () => seen.destroy() };
}
