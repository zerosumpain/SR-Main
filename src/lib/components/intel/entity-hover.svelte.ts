// Shared state for the single entity hover card.
//
// One card exists for the whole page rather than one per chat message — a long
// conversation has hundreds of mentions, and mounting a popover per message
// would be hundreds of idle components.
//
// The open/close timers are plain `let`, NOT `$state`. They are internal
// handles: nothing reactive reads them, and making them reactive would have the
// scheduling functions read and write state they are triggered by, which is the
// classic `effect_update_depth_exceeded` cycle.

/** How long the pointer must rest on a mention before the card appears. */
const OPEN_DELAY_MS = 320;
/** Grace period so the pointer can travel from the mention into the card. */
const CLOSE_DELAY_MS = 180;

export interface HoverAnchor {
  entityId: string;
  /** Viewport rect of the mention that triggered this. */
  rect: { top: number; left: number; bottom: number; right: number };
  /** Click/keyboard opens a pinned card that ignores pointer-out. */
  pinned: boolean;
}

class EntityHoverState {
  current = $state<HoverAnchor | null>(null);

  // Deliberately not $state — see the module comment.
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  private clearTimers() {
    if (this.openTimer) clearTimeout(this.openTimer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.openTimer = null;
    this.closeTimer = null;
  }

  /** Pointer rested on a mention. */
  hover(entityId: string, el: HTMLElement) {
    // A PINNED card was opened deliberately and carries the commission
    // actions; merely moving the pointer over another mention must not replace
    // it. Dismiss with Escape, the close button, or by clicking another
    // mention (which pins the new one).
    if (this.current?.pinned) return;

    this.clearTimers();
    // Already showing this one — nothing to schedule.
    if (this.current?.entityId === entityId) return;
    this.openTimer = setTimeout(() => {
      const r = el.getBoundingClientRect();
      this.current = {
        entityId,
        rect: { top: r.top, left: r.left, bottom: r.bottom, right: r.right },
        pinned: false,
      };
    }, OPEN_DELAY_MS);
  }

  /** Clicked or keyboard-activated — stays until dismissed. */
  pin(entityId: string, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    this.pinAt(entityId, { top: r.top, left: r.left, bottom: r.bottom, right: r.right });
  }

  /**
   * Same, from a rect rather than an element.
   *
   * The graph views have no element to anchor to — a node is a circle in an SVG
   * or a sphere in a WebGL canvas, neither of which has a DOM box — so they pass
   * the point the click happened at. Everything downstream already works in
   * viewport coordinates, so nothing else has to know the difference.
   */
  pinAt(entityId: string, rect: HoverAnchor['rect']) {
    this.clearTimers();
    this.current = { entityId, rect, pinned: true };
  }

  /** Pointer left the mention or the card. */
  release() {
    if (this.openTimer) clearTimeout(this.openTimer);
    this.openTimer = null;
    if (this.current?.pinned) return;
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => {
      this.current = null;
      this.closeTimer = null;
    }, CLOSE_DELAY_MS);
  }

  /** Pointer entered the card itself — cancel the pending close. */
  keepOpen() {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  close() {
    this.clearTimers();
    this.current = null;
  }
}

export const entityHover = new EntityHoverState();

/** Card geometry. Exported so the layout maths can be tested without a DOM. */
export const CARD_W = 380;
const GAP = 10;
const MARGIN = 12;
/** Below this a card is too cramped to read, so we stop trying to fit it beside
 *  the mention and let it overlap instead. */
const MIN_H = 180;

export interface HoverLayout {
  left: number;
  /** Cap for the scrolling content, so the card can never exceed the viewport. */
  maxHeight: number;
  placement: 'below' | 'above' | 'overlay';
  /** Set for 'below' and 'overlay' — the card grows downward from here. */
  top?: number;
  /**
   * Set for 'above', measured from the viewport bottom. Above-placement MUST be
   * bottom-anchored: anchoring the top edge and letting content grow pushes the
   * card down over the mention and off the bottom of the screen. Anchoring the
   * bottom makes it grow upward into the space we measured.
   */
  bottom?: number;
}

/**
 * Place the card so it is ALWAYS fully on screen, capping its height to the
 * space actually available so any overflow scrolls.
 *
 * The previous version flipped above only when there was any room at all above,
 * and otherwise fell back to below with NO height cap — so a tall card near the
 * bottom of the viewport ran off the bottom edge with no way to reach the rest.
 * Clamping only `top` fixed the top edge and left the bottom unbounded.
 *
 * This is stable against a ResizeObserver feeding the measured height back in:
 * once capped to a side's available space the measured height equals that
 * space, which still satisfies the same branch next pass. Capped-to-below keeps
 * `height <= spaceBelow`; and above is only chosen when it is the larger side,
 * so capped-to-above keeps `spaceBelow < height <= spaceAbove`.
 */
export function computeHoverLayout(
  rect: HoverAnchor['rect'],
  height: number,
  viewport: { w: number; h: number },
): HoverLayout {
  let left = rect.left;
  if (left + CARD_W + MARGIN > viewport.w) left = viewport.w - CARD_W - MARGIN;
  if (left < MARGIN) left = MARGIN;

  const spaceBelow = viewport.h - rect.bottom - GAP - MARGIN;
  const spaceAbove = rect.top - GAP - MARGIN;

  // Neither side can hold a readable card (short viewport, mention mid-screen):
  // stop dodging the mention and use the full column, scrolling inside.
  if (Math.max(spaceBelow, spaceAbove) < MIN_H) {
    return {
      top: MARGIN,
      left,
      maxHeight: Math.max(MIN_H, viewport.h - MARGIN * 2),
      placement: 'overlay',
    };
  }

  if (height <= spaceBelow || spaceBelow >= spaceAbove) {
    return { top: rect.bottom + GAP, left, maxHeight: spaceBelow, placement: 'below' };
  }

  return {
    bottom: viewport.h - rect.top + GAP,
    left,
    maxHeight: spaceAbove,
    placement: 'above',
  };
}

/**
 * Delegated handlers for a container holding rendered chat HTML.
 *
 * Returned rather than attached so the caller decides which element they sit
 * on, and so they can be spread onto a Svelte element declaratively.
 */
export function entityMentionHandlers() {
  const mentionFrom = (target: EventTarget | null): HTMLElement | null => {
    const el = target as HTMLElement | null;
    return el?.closest?.('a.entity-mention') ?? null;
  };

  return {
    onmouseover(e: MouseEvent) {
      const a = mentionFrom(e.target);
      if (!a) return;
      const id = a.getAttribute('data-entity-id');
      if (id) entityHover.hover(id, a);
    },
    onmouseout(e: MouseEvent) {
      if (!mentionFrom(e.target)) return;
      entityHover.release();
    },
    onfocusin(e: FocusEvent) {
      const a = mentionFrom(e.target);
      if (!a) return;
      const id = a.getAttribute('data-entity-id');
      if (id) entityHover.pin(id, a);
    },
    /** True when the event was an entity mention and the caller should stop. */
    handleClick(e: MouseEvent): boolean {
      const a = mentionFrom(e.target);
      if (!a) return false;
      const id = a.getAttribute('data-entity-id');
      if (!id) return false;
      e.preventDefault();
      entityHover.pin(id, a);
      return true;
    },
    handleKey(e: KeyboardEvent): boolean {
      if (e.key !== 'Enter' && e.key !== ' ') return false;
      const a = mentionFrom(e.target);
      if (!a) return false;
      const id = a.getAttribute('data-entity-id');
      if (!id) return false;
      e.preventDefault();
      entityHover.pin(id, a);
      return true;
    },
  };
}
