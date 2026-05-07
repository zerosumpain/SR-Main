/**
 * Svelte action that re-parents the element to a target outside the
 * component tree. We use this for full-viewport overlays (like the
 * BuildViewModal) so they escape ancestors with `transform`, `filter`,
 * or `perspective` set — those break `position: fixed`'s viewport anchor
 * and re-anchor it to the transformed ancestor.
 *
 * The canvas page applies `transform: translate(panX,panY) scale(zoom)`
 * on the world layer, so any modal rendered as a child of a node lands
 * inside that transform without a portal.
 */
export function portal(node: HTMLElement, target: HTMLElement | string = 'body') {
  function mount(t: HTMLElement | string) {
    const el = typeof t === 'string' ? document.querySelector(t) : t;
    if (!el) return;
    el.appendChild(node);
  }
  mount(target);
  return {
    update(next: HTMLElement | string) { mount(next); },
    destroy() { node.remove(); },
  };
}
