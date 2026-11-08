// Frames from the server, as the page holds them (spec §10.7, §10.9). The
// app forwards every SSE frame to the page through `apply`; most are deltas
// cut against the frame the phone already holds. This is the merge rule from
// engine/wire.ts written out a second time for the page (the server's
// `applyFrame` is the reference, and the app's store applies the same rule),
// so the page never needs server code.
//
// A frame cut against a rev the page does not hold cannot be merged: the
// page says `needResync` and keeps drawing what it has until a whole frame
// arrives.

import type { HometownsWire, MeWire, PublicTown, TownState } from '../engine';

/** WP4 sends changed public-card fields as a per-town patch list (null: unchanged). */
export type WireFrame = HometownsWire & { townsPatch?: (Partial<PublicTown> | null)[] };

/** The parts of `me` a delta frame leaves out when they did not change. */
export const ME_PARTS = ['derived', 'affordances', 'snapshot', 'inbox', 'predict', 'moves', 'welcomeBack'] as const;
/** Top-level parts a delta frame leaves out when they did not change. */
export const TOP_PARTS = ['county', 'visiting'] as const;

export class FrameGap extends Error {
  constructor(
    readonly have: number | null,
    readonly base: number,
  ) {
    super(`frame cut against rev ${base}, page holds ${have ?? 'nothing'}`);
  }
}

/**
 * The whole frame `frame` stands for, given the whole frame the page holds.
 * Throws FrameGap when `frame` was cut against another rev.
 */
export function mergeFrame(held: WireFrame | null, frame: WireFrame): WireFrame {
  if (frame.base === null || frame.base === undefined) {
    const whole = { ...frame, base: null } as WireFrame;
    delete whole.townsPatch;
    return whole;
  }
  if (!held || held.rev !== frame.base) throw new FrameGap(held?.rev ?? null, frame.base);
  const out = { ...frame, base: null } as WireFrame;
  const o = out as unknown as Record<string, unknown>;
  for (const k of TOP_PARTS) if (!(k in frame)) o[k] = held[k];
  if (!frame.towns) {
    const patch = frame.townsPatch;
    out.towns = (held.towns ?? []).map((card, k) => (patch?.[k] ? { ...card, ...patch[k] } : card));
  }
  delete out.townsPatch;
  if (frame.me) {
    const hm = (held.me ?? {}) as unknown as Record<string, unknown>;
    const me = { ...frame.me } as unknown as Record<string, unknown>;
    for (const k of ME_PARTS) if (!(k in frame.me)) me[k] = hm[k];
    if (!frame.me.town) {
      const town = hm.town as TownState | undefined;
      if (frame.me.townDelta && town) me.town = { ...town, ...frame.me.townDelta.changed } as TownState;
      else if (town) me.town = town;
      delete me.townDelta;
    }
    out.me = me as unknown as MeWire;
  }
  return out;
}

/** The ids of the viewer's logged moves a frame lists, joined (a change means a move landed). */
export function movesKey(frame: WireFrame | null): string {
  return (frame?.me?.moves ?? []).map((m) => m.id).join(',');
}
