// Marks a page element as part of the rambler's world. The overlay reads the
// element's box; the element itself is untouched, so links and layout behave
// exactly as before.
//
//   <div use:scenery={{ spot: 'lookout', at: 0.86 }}>

import type { Action } from 'svelte/action';
import type { Spot } from './world';

export interface SceneryOptions {
  spot?: Spot;
  at?: number;
  /** Use the element's bottom edge as the floor instead of its top. */
  edge?: 'top' | 'bottom';
}

export const sceneryElements = new Map<HTMLElement, SceneryOptions>();
const listeners = new Set<() => void>();

export function onSceneryChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const changed = () => listeners.forEach((fn) => fn());

export const scenery: Action<HTMLElement, SceneryOptions | undefined> = (node, opts) => {
  sceneryElements.set(node, opts ?? {});
  changed();
  return {
    update(next) {
      sceneryElements.set(node, next ?? {});
      changed();
    },
    destroy() {
      sceneryElements.delete(node);
      changed();
    },
  };
};
