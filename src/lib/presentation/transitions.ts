// Player transitions — the four camera moves. Sibling nav is a lateral glide.
// Zoom moves anchor to the parent slide's mini-slide card when its rect is
// known: diving, the incoming sub-slide grows out of the card while the
// parent pushes past the camera; rising, the sub-slide shrinks back into it.
// Without a rect (deep links) they fall back to centered scaling. Durations
// route through dur() so prefers-reduced-motion collapses everything to a cut.

import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';
import { dur } from '$lib/motion';

export type MoveKind = 'next' | 'prev' | 'zoomIn' | 'zoomOut';

/** The mini-slide card's place on screen when a zoom was triggered. */
export interface ZoomAnchor {
  cx: number;
  cy: number;
  w: number;
  vw: number;
  vh: number;
}

export interface MoveParams {
  move: MoveKind;
  anchor?: ZoomAnchor | null;
}

const GLIDE = 340;
const ZOOM = 560;

export function slideIn(_node: Element, { move, anchor }: MoveParams): TransitionConfig {
  const easing = cubicOut;
  switch (move) {
    case 'next':
      return { duration: dur(GLIDE), easing, css: (t, u) => `transform: translateX(${u * 44}px); opacity: ${t}` };
    case 'prev':
      return { duration: dur(GLIDE), easing, css: (t, u) => `transform: translateX(${-u * 44}px); opacity: ${t}` };
    case 'zoomIn': {
      if (anchor) {
        // Grow out of the mini-slide card: start at its center and scale.
        const s0 = Math.max(0.08, anchor.w / anchor.vw);
        const dx = anchor.cx - anchor.vw / 2;
        const dy = anchor.cy - anchor.vh / 2;
        return {
          duration: dur(ZOOM),
          easing,
          css: (t, u) =>
            `transform: translate(${dx * u}px, ${dy * u}px) scale(${s0 + (1 - s0) * t}); opacity: ${Math.min(1, t * 1.6)}`,
        };
      }
      return { duration: dur(ZOOM), easing, css: (t) => `transform: scale(${0.72 + 0.28 * t}); opacity: ${t}` };
    }
    case 'zoomOut': {
      if (anchor) {
        // The parent returns from past-the-camera, settling around its card.
        return {
          duration: dur(ZOOM),
          easing,
          css: (t, u) =>
            `transform-origin: ${anchor.cx}px ${anchor.cy}px; transform: scale(${1 + 1.6 * u}); opacity: ${Math.min(1, t * 1.4)}`,
        };
      }
      return { duration: dur(ZOOM), easing, css: (t) => `transform: scale(${1.45 - 0.45 * t}); opacity: ${t}` };
    }
  }
}

export function slideOut(_node: Element, { move, anchor }: MoveParams): TransitionConfig {
  const easing = cubicOut;
  switch (move) {
    case 'next':
      return { duration: dur(GLIDE), easing, css: (t, u) => `transform: translateX(${-u * 44}px); opacity: ${t}` };
    case 'prev':
      return { duration: dur(GLIDE), easing, css: (t, u) => `transform: translateX(${u * 44}px); opacity: ${t}` };
    case 'zoomIn': {
      if (anchor) {
        // The camera pushes toward the card: the parent scales up around it.
        return {
          duration: dur(ZOOM),
          easing,
          css: (t, u) =>
            `transform-origin: ${anchor.cx}px ${anchor.cy}px; transform: scale(${1 + 1.6 * u}); opacity: ${t}`,
        };
      }
      return { duration: dur(ZOOM), easing, css: (t, u) => `transform: scale(${1 + 0.45 * u}); opacity: ${t}` };
    }
    case 'zoomOut': {
      if (anchor) {
        // Shrink back into the parent's mini-slide card.
        const s0 = Math.max(0.08, anchor.w / anchor.vw);
        const dx = anchor.cx - anchor.vw / 2;
        const dy = anchor.cy - anchor.vh / 2;
        return {
          duration: dur(ZOOM),
          easing,
          css: (t, u) =>
            `transform: translate(${dx * u}px, ${dy * u}px) scale(${s0 + (1 - s0) * t}); opacity: ${Math.min(1, t + 0.15)}`,
        };
      }
      return { duration: dur(ZOOM), easing, css: (t, u) => `transform: scale(${1 - 0.28 * u}); opacity: ${t}` };
    }
  }
}
