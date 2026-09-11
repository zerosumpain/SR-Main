/**
 * The single hover card for the whole assessment.
 *
 * ONE card exists for the page, not one per figure. The dashboard renders
 * several hundred hoverable things — every actor name, every play, every
 * assumption, every column header — and mounting a popover per subject would be
 * several hundred idle components. This is deliberately the same shape as
 * `$lib/health/metric-peek.svelte.ts`, which is the same shape as
 * `components/intel/entity-hover.svelte.ts`: the site has one answer to this
 * problem and a third variant would be a third thing to keep in step.
 *
 * The open/close timers are plain `let`, NOT `$state`. Nothing reactive reads
 * them, and making them reactive would have `hover()` and `release()` read and
 * write the state that triggers them — the `effect_update_depth_exceeded` cycle
 * this repo has paid for twice.
 *
 * TRIGGERING IS DELEGATED, and that is what keeps this from touching the markup
 * it decorates. A figure carries one attribute — `data-pa-peek="actor:s2_dfe"` —
 * and its container spreads `{...peekHandlers()}` onto the element it already
 * had. One listener per section rather than four per figure.
 *
 * The SUBJECT KIND is in the attribute rather than looked up, because the same
 * identifier means different things in different places: an actor id under the
 * atlas wants its incentives, and the same id in the relationship map wants its
 * degree. The card renders what the anchor asked for.
 */
import { placePopover, type AnchorRect } from '$lib/health/popover';

/** How long the pointer must rest on a subject before the card appears. */
const OPEN_DELAY_MS = 260;
/** Grace period so the pointer can travel from the subject into the card. */
const CLOSE_DELAY_MS = 160;

export const PEEK_WIDTH = 340;

/**
 * What the card is being asked about.
 *
 * `term` is the glossary — a column header, a factor, a band — and it is the
 * kind that survives everywhere, because a word has nowhere else to be
 * explained. The rest name an artefact and differ only in which of its fields
 * are worth the space; they appear in PROSE and in short named lists, never in
 * a grid, where the row is already one click from the whole artefact.
 *
 * A `field` kind existed briefly, for one clipped cell of a profile. Fifty-four
 * cells each opening a popover is what made the dense views tiring, so the
 * clipped cell carries a native `title` and the kind is gone.
 */
export type PeekKind = 'actor' | 'play' | 'assumption' | 'term' | 'artefact' | 'check' | 'relation';

export interface PeekAnchor {
  kind: PeekKind;
  /** An artefact id, or a glossary key when `kind` is `term`. */
  subject: string;
  rect: AnchorRect;
  /** Click or keyboard opens a pinned card that ignores pointer-out. */
  pinned: boolean;
}

const KINDS: PeekKind[] = ['actor', 'play', 'assumption', 'term', 'artefact', 'check', 'relation'];

/**
 * Split `actor:s2_dfe` into its parts.
 *
 * An identifier may itself contain a colon, so the split is on the FIRST one
 * only; and an attribute naming a kind this build does not know is ignored
 * rather than rendered as an empty card.
 */
export function parseSubject(raw: string | null): { kind: PeekKind; subject: string } | null {
  if (!raw) return null;
  const at = raw.indexOf(':');
  if (at <= 0) return null;
  const kind = raw.slice(0, at) as PeekKind;
  const subject = raw.slice(at + 1);
  if (!KINDS.includes(kind) || !subject) return null;
  return { kind, subject };
}

class PolicyPeekState {
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

  private same(kind: PeekKind, subject: string) {
    return this.current?.kind === kind && this.current?.subject === subject;
  }

  /** Pointer rested on a subject. */
  hover(kind: PeekKind, subject: string, el: HTMLElement) {
    // A pinned card is protected from a pointer DRIFTING across the subject it
    // is already about — but not from one that comes to rest on a different
    // one. `ExplainLabel` is a button with no click handler, so clicking a
    // column header pins its card; an unconditional guard here meant that one
    // click stopped every other explainer, actor and play on the page from
    // opening at all until the reader found Escape.
    if (this.current?.pinned && this.same(kind, subject)) return;
    this.clearTimers();
    if (this.same(kind, subject)) return;
    this.openTimer = setTimeout(() => {
      this.current = { kind, subject, rect: this.rectOf(el), pinned: false };
      this.openTimer = null;
    }, OPEN_DELAY_MS);
  }

  /** Clicked or keyboard-activated — stays until dismissed. */
  pin(kind: PeekKind, subject: string, el: HTMLElement) {
    this.clearTimers();
    this.current = { kind, subject, rect: this.rectOf(el), pinned: true };
  }

  /** Pointer left the subject or the card. */
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

  /**
   * The page moved under a card that is open.
   *
   * A HOVER card is dismissed: its anchor rect was captured in viewport
   * coordinates when it opened, so the moment the page scrolls it is describing
   * whatever has moved into that spot. The reader has moved on, and a card that
   * chases its trigger is worse than one that gets out of the way.
   *
   * A PINNED card is RE-ANCHORED instead, and that distinction is not a nicety.
   * Tabbing to an explainer that is below the fold makes the browser scroll it
   * into view — so the scroll the focus itself caused was dismissing the card
   * the focus had just opened, and every off-screen explainer was unreachable by
   * keyboard while looking perfectly fine to a mouse. Measured 2026-09-11.
   *
   * The anchor is re-measured from whatever is focused, and only when it is
   * still the same subject; anything else closes, so a card can never end up
   * pointing at an element it is not about.
   */
  rescroll() {
    if (!this.current) return;
    if (!this.current.pinned) return this.close();
    const active = typeof document === 'undefined' ? null : document.activeElement;
    const host = active instanceof HTMLElement ? active.closest<HTMLElement>('[data-pa-peek]') : null;
    const parsed = parseSubject(host?.getAttribute('data-pa-peek') ?? null);
    if (!host || !parsed || parsed.kind !== this.current.kind || parsed.subject !== this.current.subject) {
      return this.close();
    }
    this.current = { ...this.current, rect: this.rectOf(host) };
  }
}

export const policyPeek = new PolicyPeekState();

/** Where the card goes — the site's own tested placement function. */
export function peekPlacement(rect: AnchorRect, height: number) {
  const viewport =
    typeof window === 'undefined'
      ? { width: 1280, height: 900 }
      : { width: window.innerWidth, height: window.innerHeight };
  return placePopover(rect, viewport, { width: PEEK_WIDTH, height });
}

/**
 * Delegated handlers for a container holding subjects marked `data-pa-peek`.
 *
 * Returned rather than attached so the caller decides which element they sit on
 * and can spread them declaratively:
 *
 *   <section {...peekHandlers()}>
 */
export function peekHandlers() {
  const from = (target: EventTarget | null): HTMLElement | null => {
    const el = target as HTMLElement | null;
    return el?.closest?.('[data-pa-peek]') ?? null;
  };
  const subjectOf = (el: HTMLElement | null) => parseSubject(el?.getAttribute('data-pa-peek') ?? null);

  return {
    onmouseover(e: MouseEvent) {
      const el = from(e.target);
      const parsed = subjectOf(el);
      if (el && parsed) policyPeek.hover(parsed.kind, parsed.subject, el);
    },
    onmouseout(e: MouseEvent) {
      if (!from(e.target)) return;
      policyPeek.release();
    },
    onfocusin(e: FocusEvent) {
      const el = from(e.target);
      const parsed = subjectOf(el);
      if (el && parsed) policyPeek.pin(parsed.kind, parsed.subject, el);
    },
    onfocusout(e: FocusEvent) {
      if (!from(e.target)) return;
      // Focus moving INTO the card is not focus leaving the subject: a
      // mousedown on "Open the play →" fires focusout on the anchor first, and
      // closing here unmounted the button before its click could land.
      const to = e.relatedTarget;
      if (to instanceof HTMLElement && to.closest('[data-pa-peek-card]')) return;
      policyPeek.close();
    },
  };
}
