// Shared state for the single metric hover card on /health.
//
// ONE card exists for the whole page. The hub renders about thirty figures, and
// mounting a popover per tile would be thirty idle components — the same
// reasoning `components/intel/entity-hover.svelte.ts` gives for chat mentions,
// and this file is deliberately the same shape as that one.
//
// The open/close timers are plain `let`, NOT `$state`. Nothing reactive reads
// them; making them reactive would have `hover()` and `release()` read and
// write state that triggers them, which is the `effect_update_depth_exceeded`
// cycle the site has hit before.
//
// Triggering is DELEGATED. Section A alone has eleven hoverable figures, and
// putting four handlers on each of them would be forty-four listeners and forty
// four pieces of markup to keep in step. Instead a figure carries one attribute
// — `data-metric="acwr"` — and the section spreads `metricPeekHandlers()` onto
// the element it already had. That is the whole change to the existing
// components, which is what keeps this from touching the look of the page.
import { placePopover, type AnchorRect } from './popover';

/** How long the pointer must rest on a figure before the card appears. */
const OPEN_DELAY_MS = 260;
/** Grace period so the pointer can travel from the figure into the card. */
const CLOSE_DELAY_MS = 160;

export const PEEK_WIDTH = 320;

export interface PeekAnchor {
  metricId: string;
  rect: AnchorRect;
  /** Click or keyboard opens a pinned card that ignores pointer-out. */
  pinned: boolean;
}

class MetricPeekState {
  current = $state<PeekAnchor | null>(null);

  // Deliberately not $state — see the module comment.
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  private clearTimers() {
    if (this.openTimer) clearTimeout(this.openTimer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.openTimer = null;
    this.closeTimer = null;
  }

  private rectOf(el: HTMLElement): AnchorRect {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
  }

  /** Pointer rested on a figure. */
  hover(metricId: string, el: HTMLElement) {
    // A pinned card was opened deliberately; drifting the pointer across the
    // grid must not replace it. Escape, the close button or pinning another
    // figure dismisses it.
    if (this.current?.pinned) return;
    this.clearTimers();
    if (this.current?.metricId === metricId) return;
    this.openTimer = setTimeout(() => {
      this.current = { metricId, rect: this.rectOf(el), pinned: false };
      this.openTimer = null;
    }, OPEN_DELAY_MS);
  }

  /** Clicked or keyboard-activated — stays until dismissed. */
  pin(metricId: string, el: HTMLElement) {
    this.clearTimers();
    this.current = { metricId, rect: this.rectOf(el), pinned: true };
  }

  /** Pointer left the figure or the card. */
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

export const metricPeek = new MetricPeekState();

/**
 * Where the card goes. Thin wrapper over `$lib/health/popover`, which is this
 * module's OWN tested placement function — the one the activity ledger's row
 * menu and the corrections panel already use.
 */
export function peekPlacement(rect: AnchorRect, height: number) {
  const viewport =
    typeof window === 'undefined'
      ? { width: 1280, height: 900 }
      : { width: window.innerWidth, height: window.innerHeight };
  return placePopover(rect, viewport, { width: PEEK_WIDTH, height });
}

/**
 * Delegated handlers for a container holding figures marked `data-metric`.
 *
 * Returned rather than attached so the caller decides which element they sit
 * on, and so they can be spread onto a Svelte element declaratively:
 *
 *   <section class="a" {...metricPeekHandlers()}>
 *
 * `attribute` exists because the SAME controller drives the activity header's
 * cohort cards, whose subjects are header cells rather than hub metrics. One
 * card is open at a time across the whole site, which is the invariant this
 * module exists for; only the attribute a figure opts in with differs, and
 * sharing the attribute name would have the two registries answering to each
 * other's ids.
 */
export function metricPeekHandlers(attribute = 'data-metric') {
  const selector = `[${attribute}]`;
  const figureFrom = (target: EventTarget | null): HTMLElement | null => {
    const el = target as HTMLElement | null;
    return el?.closest?.(selector) ?? null;
  };
  const idOf = (el: HTMLElement | null): string | null => el?.getAttribute(attribute) ?? null;

  return {
    onmouseover(e: MouseEvent) {
      const el = figureFrom(e.target);
      const id = idOf(el);
      if (el && id) metricPeek.hover(id, el);
    },
    onmouseout(e: MouseEvent) {
      if (!figureFrom(e.target)) return;
      metricPeek.release();
    },
    onfocusin(e: FocusEvent) {
      const el = figureFrom(e.target);
      const id = idOf(el);
      if (el && id) metricPeek.pin(id, el);
    },
    onfocusout(e: FocusEvent) {
      if (!figureFrom(e.target)) return;
      metricPeek.close();
    },
  };
}
