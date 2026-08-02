// Layout maths for the entity hover card.
//
// The bug these pin down: a tall card anchored near the bottom of the viewport
// used to render past the bottom edge with no height cap, so the rest of it was
// unreachable — you could neither see it nor scroll to it.

import { describe, it, expect } from 'vitest';
import { computeHoverLayout, CARD_W } from '$lib/components/intel/entity-hover.svelte';

const VP = { w: 1400, h: 900 };
const MARGIN = 12;

/** A mention's viewport rect, 18px tall, at the given top/left. */
const mention = (top: number, left: number) => ({
  top,
  left,
  bottom: top + 18,
  right: left + 90,
});

/**
 * The invariant every result must satisfy, whatever branch produced it:
 * the card is fully on screen EVEN WHEN its content fills maxHeight.
 */
function assertOnScreen(
  l: { top?: number; bottom?: number; left: number; maxHeight: number },
  vp = VP,
) {
  expect(l.left).toBeGreaterThanOrEqual(0);
  expect(l.left + CARD_W).toBeLessThanOrEqual(vp.w);

  // Exactly one vertical anchor, or the CSS is ambiguous.
  expect(l.top === undefined).not.toBe(l.bottom === undefined);

  if (l.top !== undefined) {
    expect(l.top).toBeGreaterThanOrEqual(0);
    expect(l.top + l.maxHeight).toBeLessThanOrEqual(vp.h);
  } else {
    expect(l.bottom!).toBeGreaterThanOrEqual(0);
    // Top edge when the card is at full height.
    expect(vp.h - l.bottom! - l.maxHeight).toBeGreaterThanOrEqual(0);
  }
}

describe('computeHoverLayout', () => {
  it('places a short card below the mention', () => {
    const l = computeHoverLayout(mention(100, 300), 240, VP);
    expect(l.placement).toBe('below');
    expect(l.top).toBe(100 + 18 + 10);
    assertOnScreen(l);
  });

  it('flips above when the card does not fit below, bottom-anchored', () => {
    // Mention near the bottom, plenty of room above.
    const l = computeHoverLayout(mention(760, 300), 400, VP);
    expect(l.placement).toBe('above');
    expect(l.top).toBeUndefined();
    // Bottom edge sits GAP above the mention's top.
    expect(VP.h - l.bottom!).toBe(760 - 10);
    assertOnScreen(l);
  });

  it('REGRESSION: growing content above the mention grows UPWARD, not off-screen', () => {
    const rect = mention(760, 300);
    const small = computeHoverLayout(rect, 200, VP);
    const large = computeHoverLayout(rect, 700, VP);
    // Bottom-anchored, so the anchor is identical regardless of content height —
    // that is what stops a growing card sliding down over the mention.
    expect(small.bottom).toBe(large.bottom);
    assertOnScreen(small);
    assertOnScreen(large);
  });

  it('REGRESSION: a tall card near the bottom never overflows the viewport', () => {
    // The old code fell back to "below" here and ran off the bottom edge.
    const l = computeHoverLayout(mention(700, 300), 2000, VP);
    assertOnScreen(l);
    expect(l.maxHeight).toBeGreaterThan(0);
  });

  it('REGRESSION: caps height so overflow is reachable by scrolling', () => {
    const l = computeHoverLayout(mention(400, 300), 5000, VP);
    // Content is far taller than any available space, so it MUST be capped.
    expect(l.maxHeight).toBeLessThan(5000);
    assertOnScreen(l);
  });

  it('clamps to the right edge instead of overflowing horizontally', () => {
    const l = computeHoverLayout(mention(100, 1350), 240, VP);
    expect(l.left).toBe(VP.w - CARD_W - MARGIN);
    assertOnScreen(l);
  });

  it('clamps to the left edge for a mention at x=0', () => {
    const l = computeHoverLayout(mention(100, 0), 240, VP);
    expect(l.left).toBe(MARGIN);
    assertOnScreen(l);
  });

  it('falls back to a full-height overlay when neither side is readable', () => {
    // Short viewport, mention dead centre: no side has 180px.
    const short = { w: 1400, h: 380 };
    const l = computeHoverLayout(mention(170, 300), 600, short);
    expect(l.placement).toBe('overlay');
    assertOnScreen(l, short);
  });

  it('is stable when the measured height is fed back in (no flip-flop)', () => {
    // The ResizeObserver reports the CAPPED height on the next pass; feeding
    // that back must not bounce the card to the other side forever.
    const rect = mention(700, 300);
    let l = computeHoverLayout(rect, 2000, VP);
    for (let i = 0; i < 5; i++) {
      const next = computeHoverLayout(rect, l.maxHeight, VP);
      expect(next.placement).toBe(l.placement);
      expect(next.top).toBe(l.top);
      expect(next.bottom).toBe(l.bottom);
      expect(next.maxHeight).toBe(l.maxHeight);
      l = next;
    }
  });

  it('keeps the card on screen across a sweep of positions and heights', () => {
    for (const top of [0, 50, 200, 445, 700, 860, 899]) {
      for (const height of [120, 300, 700, 3000]) {
        for (const left of [0, 400, 1100, 1399]) {
          assertOnScreen(computeHoverLayout(mention(top, left), height, VP));
        }
      }
    }
  });
});
