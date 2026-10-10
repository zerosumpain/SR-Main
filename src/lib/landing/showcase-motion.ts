// showcase-motion.ts — the small motion kit the landing showcase's three views
// share: a figure that counts up once when it first scrolls into view, a
// "seen at last" hook for a view's own flourish, an on-screen watch for
// pausing anything that moves continuously, and the heartbeat's clock.
//
// The rules it keeps for every view:
//   - the server's HTML, and a browser without JavaScript, show the FINAL
//     figure: nothing here touches the text until the count starts;
//   - prefers-reduced-motion means no tween at all, the final value stays;
//   - a figure only ever counts once, the first time it is seen;
//   - continuous motion runs only on a fresh pulse, and stops off screen and
//     in a hidden tab.
//
// No dependencies. The pure parts (easing, formatting, the tween's values,
// the beat) are unit-tested in showcase-motion.test.ts; the actions are thin
// wrappers over IntersectionObserver and requestAnimationFrame.

import type { Action, ActionReturn } from 'svelte/action';
import type { Pulse } from './sentence';
import { clampBpm } from './traces';

/** How much of an element must show before it counts as seen. */
export const SEEN_RATIO = 0.35;
/** How long a headline figure takes to count up, in ms. */
export const COUNT_MS = 900;
/** The real minus sign, never a hyphen. */
export const MINUS = '−';

/* ------------------------------------------------------------------- pure */

/** Cubic ease-out: fast away, gentle landing. Clamped to 0..1. */
export function easeOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

/**
 * A figure as the showcase prints it: en-GB grouping, a fixed number of
 * decimals, the real minus sign and never a "-0". Use the same call in the
 * template and in countUp, so the text the count lands on is the text the
 * server rendered.
 */
export function formatFigure(n: number, decimals = 0): string {
  const d = Math.max(0, Math.min(6, Math.floor(decimals)));
  const s = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
  // A value that rounds to zero is zero, whichever side it came from.
  const zero = Number(s.replace(/,/g, '')) === 0;
  return n < 0 && !zero ? `${MINUS}${s}` : s;
}

/**
 * The value a count shows `elapsed` ms in, rounded to its decimals so the
 * digits never flicker through extra places. Lands exactly on `to`.
 */
export function tweenValue(to: number, elapsed: number, duration = COUNT_MS, decimals = 0): number {
  if (!(duration > 0) || elapsed >= duration) return to;
  const raw = to * easeOut(elapsed / duration);
  const k = 10 ** Math.max(0, Math.floor(decimals));
  return Math.round(raw * k) / k;
}

/**
 * The CSS clock for a fresh pulse: seconds per beat as a `--beat` value
 * ("0.833s"), or null when the pulse is stale or missing, in which case
 * nothing should beat at all. The rate is clamped to the range the hero draws.
 */
export function beatFor(pulse: Pulse | null | undefined): string | null {
  if (!pulse || pulse.state !== 'fresh' || !(pulse.bpm > 0)) return null;
  const s = 60 / clampBpm(pulse.bpm);
  return `${Math.round(s * 1000) / 1000}s`;
}

/** True when the reader has asked for less motion (false on the server). */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * True when `el` starts below the visible screen. Only such a figure may be
 * armed (dropped to zero, its flourish held at the first frame) and counted
 * up: one already in view at hydration, or scrolled past on a restored
 * scroll, keeps the final value the server rendered rather than flashing to
 * zero in front of the reader. False on the server and for no element.
 */
export function belowFold(el: Element | null | undefined): boolean {
  return !!el && typeof innerHeight === 'number' && el.getBoundingClientRect().top > innerHeight;
}

/* ---------------------------------------------------------------- actions */

/**
 * Calls `cb` once, the first time at least SEEN_RATIO of the element is on
 * screen; at once where there is no IntersectionObserver. Use it to start a
 * view's own flourish:
 *
 *   <div use:firstView={() => (shown = true)}>
 *
 * or call it directly from an attachment: `{@attach (n) => firstView(n, cb).destroy}`.
 */
export function firstView(node: Element, cb: () => void): ActionReturn<() => void> & { destroy(): void } {
  let fn = cb;
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    fn();
  };
  if (typeof IntersectionObserver !== 'function') {
    fire();
    return { update: (next) => (fn = next), destroy() {} };
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= SEEN_RATIO)) {
        io.disconnect();
        fire();
      }
    },
    { threshold: [SEEN_RATIO] },
  );
  io.observe(node);
  return {
    update: (next) => (fn = next),
    destroy: () => io.disconnect(),
  };
}

/**
 * Calls `cb(true)` when the element is on screen in a visible tab and
 * `cb(false)` when it scrolls away or the tab is hidden, only on changes.
 * Anything that moves continuously pauses on false. Where there is no
 * IntersectionObserver the element counts as on screen.
 *
 *   <svg use:onScreen={(on) => (away = !on)}>
 */
export function onScreen(
  node: Element,
  cb: (visible: boolean) => void,
): ActionReturn<(visible: boolean) => void> & { destroy(): void } {
  let fn = cb;
  let inView = typeof IntersectionObserver !== 'function';
  let last: boolean | null = null;
  const report = () => {
    const now = inView && !(typeof document !== 'undefined' && document.hidden);
    if (now !== last) {
      last = now;
      fn(now);
    }
  };
  const io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          inView = entries[entries.length - 1]?.isIntersecting ?? inView;
          report();
        })
      : null;
  io?.observe(node);
  const onVis = () => report();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  if (!io) report();
  return {
    update: (next) => (fn = next),
    destroy() {
      io?.disconnect();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    },
  };
}

export interface CountUpOptions {
  /** The final figure; null leaves the element alone (its dash stays). */
  to: number | null;
  /** Decimal places, as the template prints them. Default 0. */
  decimals?: number;
  /** ms, default COUNT_MS. */
  duration?: number;
  /** Turns a value into text; default formatFigure(n, decimals). Must match the template. */
  format?: (n: number) => string;
}

/**
 * Counts a headline figure up from zero, once, the first time it is seen.
 *
 *   <span class="fig" use:countUp={{ to: n }}>{formatFigure(n)}</span>
 *
 * The element should hold only the figure's text, formatted exactly as
 * `format` would (formatFigure by default). Until the count starts the text
 * is left as the server rendered it, so without JavaScript, under reduced
 * motion, or for a figure never scrolled to, the final value shows. While it
 * counts, the element keeps the width of its final text (with tabular-nums in
 * the view's CSS, nothing around it moves). A new `to` mid-count lands
 * straight on the new figure.
 */
export const countUp: Action<HTMLElement, CountUpOptions> = (node, initial) => {
  let opts = initial;
  let frame = 0;
  let started = false;
  const fmt = (n: number) => (opts.format ?? ((x: number) => formatFigure(x, opts.decimals ?? 0)))(n);

  // Svelte keeps its own reference to the text node, so the count writes into
  // that same node rather than replacing it; later updates still land.
  const textNode = (): Text => {
    for (const c of node.childNodes) if (c.nodeType === 3) return c as Text;
    const t = document.createTextNode('');
    node.appendChild(t);
    return t;
  };
  const write = (s: string) => {
    const t = textNode();
    if (t.data !== s) t.data = s;
  };

  let restore: (() => void) | null = null;
  const hold = () => {
    const w = node.getBoundingClientRect().width;
    const style = node.style;
    const prev = { display: style.display, minWidth: style.minWidth };
    if (getComputedStyle(node).display === 'inline') style.display = 'inline-block';
    style.minWidth = `${w}px`;
    restore = () => {
      style.display = prev.display;
      style.minWidth = prev.minWidth;
      restore = null;
    };
  };
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    restore?.();
  };

  const run = () => {
    const to = opts.to;
    if (started || to == null || !Number.isFinite(to) || to === 0 || prefersReducedMotion()) return;
    started = true;
    const duration = opts.duration ?? COUNT_MS;
    const decimals = opts.decimals ?? 0;
    hold();
    const t0 = performance.now();
    const step = (t: number) => {
      const target = opts.to;
      if (target == null) return stop();
      const elapsed = t - t0;
      write(fmt(tweenValue(target, elapsed, duration, decimals)));
      if (elapsed < duration) frame = requestAnimationFrame(step);
      else stop();
    };
    write(fmt(0));
    frame = requestAnimationFrame(step);
  };

  const seen = firstView(node, run);
  return {
    update(next) {
      const was = opts;
      opts = next;
      if (frame && (next.to !== was.to || next.decimals !== was.decimals)) {
        stop();
        if (next.to != null) write(fmt(next.to));
      }
    },
    destroy() {
      seen.destroy();
      stop();
    },
  };
};
