// motion.ts — the study's whole animation vocabulary, as Svelte attachments.
//
// Everything here is progressive: the server renders every element in its finished state,
// and these only add movement once the page is running in a browser. A reader who has asked
// the system for reduced motion gets the finished state and nothing else, so no explainer is
// ever withheld behind an animation.
//
// Motion (motion.dev, MIT) does the scroll and viewport work, because its `inView` and
// `scroll` are the two things IntersectionObserver and scroll listeners get subtly wrong.
// Continuous loops (gears, flowing dashes) are plain CSS keyframes in the components, which
// the browser runs off the main thread and the reduced-motion media query switches off.

import { animate, inView, scroll, stagger } from 'motion';
import { prefersReducedMotion } from 'svelte/motion';
import type { Attachment } from 'svelte/attachments';

/** True when the reader has asked for reduced motion. Read at call time, not import time. */
export const still = (): boolean => prefersReducedMotion.current;

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface RevealOpts {
  /** Distance it rises from, in px. */
  y?: number;
  delay?: number;
  duration?: number;
  /** Share of the element that must be visible first. */
  amount?: number;
}

/** Rise and fade in the first time the element scrolls into view. */
export function reveal({ y = 28, delay = 0, duration = 0.9, amount = 0.2 }: RevealOpts = {}): Attachment<HTMLElement | SVGElement> {
  return (el) => {
    if (still()) return;
    el.style.opacity = '0';
    el.style.transform = `translateY(${y}px)`;
    const stop = inView(el, () => {
      animate(el, { opacity: [0, 1], transform: [`translateY(${y}px)`, 'translateY(0px)'] }, { duration, delay, ease: EASE });
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
    const stop = inView(el, () => {
      animate(kids, { opacity: [0, 1], transform: [`translateY(${y}px)`, 'translateY(0px)'] }, { duration, delay: stagger(gap), ease: EASE });
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
    return scroll((p: number) => cb(p), { target: el, offset: offset as never });
  };
}

/**
 * Which of a container's `[data-step]` children is in the reading line, for a scrollytelling
 * column. Calls back with the step's index whenever it changes.
 */
export function steps(cb: (i: number) => void, { line = 0.5 }: { line?: number } = {}): Attachment<HTMLElement> {
  return (el) => {
    const items = [...el.querySelectorAll<HTMLElement>('[data-step]')];
    if (!items.length) return;
    let current = -1;
    const pick = () => {
      const y = window.innerHeight * line;
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
