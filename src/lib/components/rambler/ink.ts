// The page's own colours, read off the CSS tokens, for the explainer's canvases.
import type { Ink } from '$lib/landing/ramblers/draw';

export function readInk(): Ink {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return { ink: v('--text-primary', '#1a1008'), paper: v('--bg', '#ede4d4'), muted: v('--text-muted', '#6b6158'), font: v('--font-mono', 'monospace') };
}

/** Whole device pixels per art pixel, as on the landing page. */
export function artPixel(dpr: number, at = 1.5) {
  return Math.max(2, Math.floor(at * dpr + 0.01)) / dpr;
}
