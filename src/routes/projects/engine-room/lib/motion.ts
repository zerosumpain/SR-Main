// motion.ts — the study's whole animation vocabulary, as Svelte attachments.
//
// Everything here is progressive: the server renders every element in its finished state,
// and these only add movement once the page is running in a browser. A reader who has asked
// the system for reduced motion gets the finished state and nothing else, so no explainer is
// ever withheld behind an animation.
//
// No animation library: the platform has everything this needs. IntersectionObserver for
// "has it been seen", one passive scroll listener for progress, and the Web Animations API
// (`element.animate`) for entrances. Motion (motion.dev) was used first and dropped before
// release, because adding any dependency re-runs the production audit, and an unfixable
// transitive advisory then blocked the whole release. Continuous loops (gears, flowing
// dashes) are plain CSS keyframes in the components, which the reduced-motion media query
// switches off.

import { prefersReducedMotion } from 'svelte/motion';
import type { Attachment } from 'svelte/attachments';

/** True when the reader has asked for reduced motion. Read at call time, not import time. */
export const still = (): boolean => prefersReducedMotion.current;

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Call `enter` when the element comes into view. If `enter` returns a function, it is called
 * when the element leaves again. Returns a stop function. `amount` is the share of the
 * element that must be visible.
 */
export function inView(el: Element, enter: () => void | (() => void), { amount = 0 }: { amount?: number } = {}): () => void {
  let leave: void | (() => void);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { if (!leave) leave = enter() ?? undefined; }
      else if (leave) { leave(); leave = undefined; }
    }
  }, { threshold: Math.min(Math.max(amount, 0), 1) });
  io.observe(el);
  return () => { io.disconnect(); if (leave) leave(); };
}

const EDGE: Record<string, number> = { start: 0, center: 0.5, end: 1 };

/**
 * Report scroll progress 0 → 1. With no target, through the whole page. With a target, from
 * the moment its `offset[0]` edge meets the viewport's to the moment its `offset[1]` edge does
 * (the strings are '<target edge> <viewport edge>', e.g. 'start end').
 */
export function scroll(cb: (p: number) => void, { target, offset = ['start end', 'end start'] }: { target?: Element; offset?: [string, string] } = {}): () => void {
  const at = (pair: string, r: DOMRect, vh: number) => {
    const [t, v] = pair.split(' ');
    return r.top + r.height * (EDGE[t] ?? 0) - vh * (EDGE[v] ?? 0);
  };
  let raf = 0;
  const run = () => {
    raf = 0;
    let p: number;
    if (!target) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      p = max > 0 ? window.scrollY / max : 0;
    } else {
      const r = target.getBoundingClientRect(), vh = window.innerHeight;
      const a = at(offset[0], r, vh), b = at(offset[1], r, vh);
      p = a === b ? 0 : a / (a - b);
    }
    cb(Math.min(1, Math.max(0, p)));
  };
  const on = () => { if (!raf) raf = requestAnimationFrame(run); };
  run();
  window.addEventListener('scroll', on, { passive: true });
  window.addEventListener('resize', on);
  return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on); if (raf) cancelAnimationFrame(raf); };
}

/** Rise and fade an element in, then leave it with no inline animation state. */
function rise(el: Element, y: number, duration: number, delay: number) {
  const a = el.animate([{ opacity: 0, transform: `translateY(${y}px)` }, { opacity: 1, transform: 'translateY(0px)' }],
    { duration: duration * 1000, delay: delay * 1000, easing: EASE, fill: 'backwards' });
  (el as HTMLElement).style.opacity = '';
  (el as HTMLElement).style.transform = '';
  return a;
}

interface RevealOpts {
  /** Distance it rises from, in px. */
  y?: number;
  delay?: number;
  duration?: number;
  /** Share of the element that must be visible first. */
  amount?: number;
  /** Watch the parent instead: for an element that starts clipped inside an overflow mask. */
  parent?: boolean;
}

/** Rise and fade in the first time the element scrolls into view. */
export function reveal({ y = 28, delay = 0, duration = 0.9, amount = 0.2, parent = false }: RevealOpts = {}): Attachment<HTMLElement | SVGElement> {
  return (el) => {
    if (still()) return;
    el.style.opacity = '0';
    el.style.transform = `translateY(${y}px)`;
    let done = false;
    const stop = inView(parent && el.parentElement ? el.parentElement : el, () => {
      if (done) return;
      done = true;
      rise(el, y, duration, delay);
    }, { amount });
    return () => {
      stop();
      el.style.opacity = '';
      el.style.transform = '';
    };
  };
}

/** Reveal each direct child matching `selector` in turn — for card grids and lists. */
export function cascade(selector = ':scope > *', { y = 22, gap = 0.08, duration = 0.7, amount = 0.15 }: { y?: number; gap?: number; duration?: number; amount?: number } = {}): Attachment<HTMLElement | SVGElement> {
  return (el) => {
    if (still()) return;
    const kids = [...el.querySelectorAll<HTMLElement | SVGElement>(selector)];
    if (!kids.length) return;
    for (const k of kids) { k.style.opacity = '0'; k.style.transform = `translateY(${y}px)`; }
    let done = false;
    const stop = inView(el, () => {
      if (done) return;
      done = true;
      kids.forEach((k, i) => rise(k, y, duration, i * gap));
    }, { amount });
    return () => {
      stop();
      for (const k of kids) { k.style.opacity = ''; k.style.transform = ''; }
    };
  };
}

/**
 * Mark the element `data-shown` once it has been seen. CSS does the rest — the line-drawing
 * paths (`[data-draw]`, see the layout) and any staged entrance a component keys off it.
 */
export function shown({ amount = 0.3 }: { amount?: number } = {}): Attachment<HTMLElement | SVGElement> {
  return (el) => {
    if (still()) { el.setAttribute('data-shown', ''); return; }
    el.setAttribute('data-armed', '');
    const stop = inView(el, () => { el.setAttribute('data-shown', ''); }, { amount });
    return () => stop();
  };
}

/**
 * Report how far the element has travelled through the viewport, 0 → 1, as the reader
 * scrolls. Under reduced motion it reports 1 once, so a scrubbed scene shows its end state.
 */
export function progress(cb: (p: number) => void, offset: [string, string] = ['start end', 'end start']): Attachment<HTMLElement> {
  return (el) => {
    if (still()) { cb(1); return; }
    // Motion's offset strings are a template-literal type; ours are checked by the call sites.
    return scroll((p: number) => cb(p), { target: el, offset });
  };
}

/**
 * Which of a container's `[data-step]` children is in the reading line, for a scrollytelling
 * column. Calls back with the step's index whenever it changes.
 */
export function steps(cb: (i: number) => void, { line = 0.5 }: { line?: number | (() => number) } = {}): Attachment<HTMLElement> {
  return (el) => {
    const items = [...el.querySelectorAll<HTMLElement>('[data-step]')];
    if (!items.length) return;
    let current = -1;
    const pick = () => {
      const y = window.innerHeight * (typeof line === 'function' ? line() : line);
      let best = 0;
      for (let i = 0; i < items.length; i++) if (items[i].getBoundingClientRect().top <= y) best = i;
      if (best !== current) { current = best; cb(best); }
    };
    pick();
    window.addEventListener('scroll', pick, { passive: true });
    window.addEventListener('resize', pick);
    return () => {
      window.removeEventListener('scroll', pick);
      window.removeEventListener('resize', pick);
    };
  };
}

/** Pause an element's CSS animations while it is off screen, so idle loops cost nothing. */
export function liveOnlyInView(): Attachment<HTMLElement | SVGElement> {
  return (el) => {
    el.setAttribute('data-paused', '');
    return inView(el, () => {
      el.removeAttribute('data-paused');
      return () => el.setAttribute('data-paused', '');
    }, { amount: 0 });
  };
}
