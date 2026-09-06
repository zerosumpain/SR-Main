import { describe, it, expect } from 'vitest';
import { computeHoverLayout, constrainPanel, CARD_W } from './entity-hover.svelte';

// The file this tests has always claimed to be covered here. It was not — this
// file did not exist, and the bug below shipped because of it: a card anchored
// to a point that had drifted outside the viewport was placed against that
// point and hung off the screen.

const MARGIN = 12;
const VIEW = { w: 1440, h: 900 };

/** Where the card's far edge actually lands, whichever way it is anchored. */
function edges(layout: ReturnType<typeof computeHoverLayout>, height: number, h: number) {
  const drawn = Math.min(height, layout.maxHeight);
  const top = layout.bottom !== undefined ? h - layout.bottom - drawn : (layout.top ?? 0);
  return { top, bottom: top + drawn };
}

const point = (x: number, y: number) => ({ top: y, bottom: y, left: x, right: x });

describe('computeHoverLayout', () => {
  it('places a card below its anchor when there is room', () => {
    const l = computeHoverLayout(point(400, 100), 300, VIEW);
    expect(l.placement).toBe('below');
    expect(l.top).toBe(110);
  });

  it('flips above when below is the smaller side', () => {
    const l = computeHoverLayout(point(400, 800), 400, VIEW);
    expect(l.placement).toBe('above');
    expect(l.bottom).toBeDefined();
  });

  it('never lets the card run off the right edge', () => {
    const l = computeHoverLayout(point(1430, 100), 300, VIEW);
    expect(l.left + CARD_W).toBeLessThanOrEqual(VIEW.w - MARGIN);
  });

  it('never lets the card run off the left edge', () => {
    const l = computeHoverLayout(point(-50, 100), 300, VIEW);
    expect(l.left).toBeGreaterThanOrEqual(MARGIN);
  });

  it('overlays when neither side can hold a readable card', () => {
    const l = computeHoverLayout(point(400, 200), 300, { w: 1440, h: 400 });
    expect(l.placement).toBe('overlay');
    expect(l.maxHeight).toBeLessThanOrEqual(400 - MARGIN * 2);
  });

  describe('a stale anchor cannot push the card off screen', () => {
    // The measured regression: a card opened at y=484 in a 900px-tall window,
    // then the window resized to 460. The anchor is now BELOW the viewport, so
    // `spaceAbove` was computed from an off-screen coordinate and the card was
    // placed against it — 14px past the bottom edge, unreachable.
    it('an anchor below the fold', () => {
      const h = 460;
      const l = computeHoverLayout(point(400, 484), 462, { w: 1024, h });
      const { top, bottom } = edges(l, 462, h);
      expect(top).toBeGreaterThanOrEqual(MARGIN - 0.001);
      expect(bottom).toBeLessThanOrEqual(h - MARGIN + 0.001);
    });

    it('an anchor above the fold', () => {
      const h = 600;
      const l = computeHoverLayout(point(400, -300), 400, { w: 1024, h });
      const { top, bottom } = edges(l, 400, h);
      expect(top).toBeGreaterThanOrEqual(MARGIN - 0.001);
      expect(bottom).toBeLessThanOrEqual(h - MARGIN + 0.001);
    });

    it('an anchor far past the bottom right', () => {
      const h = 500;
      const l = computeHoverLayout(point(9000, 9000), 900, { w: 1024, h });
      const { top, bottom } = edges(l, 900, h);
      expect(top).toBeGreaterThanOrEqual(MARGIN - 0.001);
      expect(bottom).toBeLessThanOrEqual(h - MARGIN + 0.001);
      expect(l.left + CARD_W).toBeLessThanOrEqual(1024 - MARGIN);
    });
  });

  it('stays on screen for every anchor and viewport worth trying', () => {
    // The property the whole function exists to guarantee, asserted over the
    // grid rather than at the three points someone happened to think of.
    for (const h of [400, 460, 620, 900, 1200]) {
      for (const w of [800, 1024, 1440]) {
        for (const y of [-400, -1, 0, 50, h / 2, h - 1, h, h + 400]) {
          for (const x of [-200, 0, w / 2, w - 1, w + 300]) {
            for (const height of [80, 300, 462, 1500]) {
              const l = computeHoverLayout(point(x, y), height, { w, h });
              const { top, bottom } = edges(l, height, h);
              expect(l.left).toBeGreaterThanOrEqual(MARGIN);
              expect(l.left + CARD_W).toBeLessThanOrEqual(w - MARGIN + 0.001);
              expect(top).toBeGreaterThanOrEqual(MARGIN - 0.001);
              expect(bottom).toBeLessThanOrEqual(h - MARGIN + 0.001);
              expect(l.maxHeight).toBeLessThanOrEqual(Math.max(180, h - MARGIN * 2) + 0.001);
            }
          }
        }
      }
    }
  });
});

// Tiny viewports and manual movement must preserve access to the whole panel.
describe('small viewports and dragging', () => {
  it('caps the card even when the viewport is shorter than the preferred minimum', () => {
    const l = computeHoverLayout(point(300, 90), 800, { w: 320, h: 160 });
    const { top, bottom } = edges(l, 800, 160);
    expect(top).toBeGreaterThanOrEqual(12);
    expect(bottom).toBeLessThanOrEqual(148);
  });

  it('keeps a responsive card inside a phone viewport', () => {
    const l = computeHoverLayout(point(380, 300), 800, { w: 390, h: 844 });
    expect(l.left + Math.min(CARD_W, 390 - 24)).toBeLessThanOrEqual(378);
  });

  it('bounds movement and recovers after content growth or window shrink', () => {
    expect(constrainPanel({ left: -300, top: -100 }, { w: 380, h: 400 }, VIEW))
      .toEqual({ left: 12, top: 12 });
    expect(constrainPanel({ left: 1400, top: 880 }, { w: 380, h: 400 }, VIEW))
      .toEqual({ left: 1048, top: 488 });
    expect(constrainPanel({ left: 1048, top: 488 }, { w: 366, h: 436 }, { w: 390, h: 460 }))
      .toEqual({ left: 12, top: 12 });
  });
});
