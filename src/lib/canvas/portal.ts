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
 *
 * Pass `false` to disable the portal (no-op). Useful for responsive
 * cases like mobile mode where we want portaling on phones but the
 * element stays in place on desktop. Toggling at runtime (via the
 * action's `update`) restores to the original parent.
 */
export type PortalTarget = HTMLElement | string | false;

export function portal(node: HTMLElement, target: PortalTarget = 'body') {
  const originalParent = node.parentNode;
  const originalNextSibling = node.nextSibling;

  function applyTarget(t: PortalTarget) {
    if (t === false) {
      // Restore to original parent at original position.
      if (originalParent && originalParent.isConnected) {
        if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
          originalParent.insertBefore(node, originalNextSibling);
        } else {
          originalParent.appendChild(node);
        }
      }
      return;
    }
    const el = typeof t === 'string' ? document.querySelector(t) : t;
    if (!el) return;
    if (node.parentNode !== el) el.appendChild(node);
  }

  applyTarget(target);
  return {
    update(next: PortalTarget) { applyTarget(next); },
    destroy() {
      // The component is unmounting. The portaled node must be removed from the
      // DOM wherever it currently lives (target/body). Never re-parent to
      // originalParent: for consumers that wrap the portal in an internal {#if}
      // (InspectorDrawer, MobileBottomSheet), originalParent stays connected on
      // close and re-appending would re-show the overlay — that is the bug this
      // fixes. node.remove() is a safe no-op when parentNode is already null.
      node.remove();
    },
  };
}
