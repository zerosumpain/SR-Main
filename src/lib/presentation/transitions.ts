// Player transitions — the camera glides in the direction of travel across
// the deck's 2D field: lateral for plane moves on horizontal planes, vertical
// for journeys and vertical-plane moves. Branch moves (down/right into a
// journey) glide a little further and slower, so entering a side story reads
// as a bigger camera move than walking siblings. Durations route through
// dur() so prefers-reduced-motion collapses everything to a cut.

import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';
import { dur } from '$lib/motion';
import type { Travel } from './navigation';

export interface MoveParams {
  travel: Travel;
  /** Branch/exit moves glide further than sibling walks. */
  major?: boolean;
  /** Active wipe effect id (melt/shatter/inkbleed/slats/dissolve). Veil wipes
   *  (melt, shatter) drop the outgoing slide fast — particles replace it —
   *  and hold the incoming one back a beat; covering wipes just delay the
   *  incoming slide under their flood. */
  wipe?: string;
}

const GLIDE = 380;
const MAJOR = 520;

/** Wipes where particles replace the outgoing DOM (it must vanish fast). */
const VEIL = new Set(['melt', 'shatter']);

/** How long the incoming slide holds back under each wipe, ms. */
const IN_DELAY: Record<string, number> = {
  melt: 340,
  shatter: 340,
  inkbleed: 320,
  dissolve: 200,
  slats: 0,
  iris: 380,
  erode: 300,
};

/** Block entrance: rise + settle with a micro-scale — used with a stagger
 *  delay by SlideView and by block-internal choreography. */
export function blockIn(_node: Element, { delay = 0 }: { delay?: number } = {}): TransitionConfig {
  return {
    delay: dur(delay),
    duration: dur(560),
    easing: cubicOut,
    css: (t, u) => `transform: translateY(${u * 26}px) scale(${0.985 + 0.015 * t}); opacity: ${t}`,
  };
}

/** Signed offscreen-edge unit vector for where an INCOMING slide starts. */
function vec(travel: Travel): { x: number; y: number } {
  switch (travel) {
    case 'right':
      return { x: 1, y: 0 };
    case 'left':
      return { x: -1, y: 0 };
    case 'down':
      return { x: 0, y: 1 };
    case 'up':
      return { x: 0, y: -1 };
  }
}

export function slideIn(_node: Element, { travel, major = false, wipe }: MoveParams): TransitionConfig {
  const { x, y } = vec(travel);
  const dist = major ? 12 : 7;
  const delay = wipe ? (IN_DELAY[wipe] ?? 0) : 0;
  return {
    delay: dur(delay),
    duration: dur(major || delay ? MAJOR : GLIDE),
    easing: cubicOut,
    css: (t, u) =>
      `transform: translate(${x * u * dist}vw, ${y * u * dist}vh) scale(${0.99 + 0.01 * t}); opacity: ${t}`,
  };
}

export function slideOut(_node: Element, { travel, major = false, wipe }: MoveParams): TransitionConfig {
  if (wipe && VEIL.has(wipe)) {
    // the content melts/shatters: drop fast with a slight sag — the particle
    // layer takes over the storytelling
    return {
      duration: dur(230),
      easing: cubicOut,
      css: (t, u) => `transform: translateY(${u * 2.5}vh); opacity: ${t}`,
    };
  }
  const { x, y } = vec(travel);
  const dist = major ? 12 : 7;
  return {
    duration: dur(major ? MAJOR : GLIDE),
    easing: cubicOut,
    css: (t, u) =>
      `transform: translate(${-x * u * dist}vw, ${-y * u * dist}vh) scale(${0.99 + 0.01 * t}); opacity: ${t}`,
  };
}
