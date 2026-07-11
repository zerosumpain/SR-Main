// Player transitions — the four camera moves. Sibling nav is a lateral glide;
// zoom-in pushes the camera "through" the outgoing slide while the sub-slide
// grows in; zoom-out is the exact inverse. Durations route through dur() so
// prefers-reduced-motion collapses everything to a cut.

import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';
import { dur } from '$lib/motion';

export type MoveKind = 'next' | 'prev' | 'zoomIn' | 'zoomOut';

const GLIDE = 340;
const ZOOM = 520;

export function slideIn(_node: Element, { move }: { move: MoveKind }): TransitionConfig {
  const easing = cubicOut;
  switch (move) {
    case 'next':
      return { duration: dur(GLIDE), easing, css: (t, u) => `transform: translateX(${u * 44}px); opacity: ${t}` };
    case 'prev':
      return { duration: dur(GLIDE), easing, css: (t, u) => `transform: translateX(${-u * 44}px); opacity: ${t}` };
    case 'zoomIn':
      return { duration: dur(ZOOM), easing, css: (t) => `transform: scale(${0.72 + 0.28 * t}); opacity: ${t}` };
    case 'zoomOut':
      return { duration: dur(ZOOM), easing, css: (t) => `transform: scale(${1.45 - 0.45 * t}); opacity: ${t}` };
  }
}

export function slideOut(_node: Element, { move }: { move: MoveKind }): TransitionConfig {
  const easing = cubicOut;
  switch (move) {
    case 'next':
      return { duration: dur(GLIDE), easing, css: (t, u) => `transform: translateX(${-u * 44}px); opacity: ${t}` };
    case 'prev':
      return { duration: dur(GLIDE), easing, css: (t, u) => `transform: translateX(${u * 44}px); opacity: ${t}` };
    case 'zoomIn':
      // camera pushes through the parent: it scales up past the viewport
      return { duration: dur(ZOOM), easing, css: (t, u) => `transform: scale(${1 + 0.45 * u}); opacity: ${t}` };
    case 'zoomOut':
      // the child shrinks away as the camera pulls back to the parent plane
      return { duration: dur(ZOOM), easing, css: (t, u) => `transform: scale(${1 - 0.28 * u}); opacity: ${t}` };
  }
}
