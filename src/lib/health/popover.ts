// Where a floating panel goes so that all of it stays on screen.
//
// Lifted out of the old ActivityTable so the activity DETAIL page could hang
// the same corrections menu off a button without importing a 1,900-line table
// to get at one pure function. That table is gone; both the ledger's shared
// row menu and ActivityCorrections place their panels through this, and
// $lib/health/activity-list re-exports it so the tests have one import.

/** Gap between the trigger and the panel. */
export const POP_GAP = 4;
/** How close to a viewport edge a panel is allowed to sit. */
export const POP_MARGIN = 8;
/** A panel never shrinks below this — it scrolls inside itself instead. */
export const POP_MIN_HEIGHT = 140;
/** Assumed height on the first pass, before the panel exists to be measured. */
export const POP_EST_HEIGHT = 320;
export const POP_WIDTH = 300;

/** The trigger's viewport rect — the four numbers placement actually reads. */
export interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface PopoverPlacement {
  left: number;
  top: number;
  /** What the panel may grow to here; beyond it the panel scrolls. */
  maxHeight: number;
  /** True when there was no room below and the panel sits above its trigger. */
  flipped: boolean;
}

export function clampTo(value: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * Where a fixed panel goes so that all of it is on screen: clamped
 * horizontally, flipped above its trigger when there is no room below, and
 * given a max height that fits whichever side it landed on.
 *
 * `align: 'end'` hangs the panel off the trigger's right edge, which is what
 * the row menu wants — its trigger is the last column.
 */
export function placePopover(
  anchor: AnchorRect,
  viewport: ViewportSize,
  options: { width?: number; height?: number; align?: 'start' | 'end' } = {},
): PopoverPlacement {
  const width = options.width ?? POP_WIDTH;
  const height = Math.max(1, options.height ?? POP_EST_HEIGHT);

  const wantedLeft = options.align === 'end' ? anchor.right - width : anchor.left;
  const left = clampTo(wantedLeft, POP_MARGIN, viewport.width - width - POP_MARGIN);

  const roomBelow = Math.max(0, viewport.height - anchor.bottom - POP_GAP - POP_MARGIN);
  const roomAbove = Math.max(0, anchor.top - POP_GAP - POP_MARGIN);
  // Below by default. Above only when the panel does not fit below AND above
  // is genuinely roomier, so a panel never changes sides over a few pixels.
  const flipped = height > roomBelow && roomAbove > roomBelow;
  const maxHeight = Math.max(POP_MIN_HEIGHT, flipped ? roomAbove : roomBelow);
  const used = Math.min(height, maxHeight);
  const top = flipped
    ? Math.max(POP_MARGIN, anchor.top - POP_GAP - used)
    : clampTo(
        anchor.bottom + POP_GAP,
        POP_MARGIN,
        Math.max(POP_MARGIN, viewport.height - POP_MARGIN - used),
      );

  return { left, top, maxHeight, flipped };
}
