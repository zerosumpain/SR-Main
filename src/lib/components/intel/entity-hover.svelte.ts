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
    this.clearTimers();
    // Already showing this one — nothing to schedule.
    if (this.current?.entityId === entityId && !this.current.pinned) return;
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
    this.clearTimers();
    const r = el.getBoundingClientRect();
    this.current = {
      entityId,
      rect: { top: r.top, left: r.left, bottom: r.bottom, right: r.right },
      pinned: true,
    };
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
