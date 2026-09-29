// What the web table derives from a Liar's Dice wire room — client-safe and
// pure. Legality is NOT decided here: every option is asked of the rules
// module's own `bidProblem`, so the picker can never offer a bid the server
// would refuse (or hide one it would take).

import { bidProblem, FACES } from './liars-dice';
import type { WireRoom } from './liars-dice';

export type BidLike = { quantity: number; face: number };

/** Every face 1–6, with whether it is biddable at `quantity` against the standing bid. */
export function facesAt(
  quantity: number,
  standing: BidLike | null,
  total: number,
  wild: boolean,
): { face: number; legal: boolean }[] {
  return Array.from({ length: FACES }, (_, i) => {
    const face = i + 1;
    return { face, legal: bidProblem({ quantity, face }, standing, total, wild) === null };
  });
}

/** Quantities with at least one legal face, lowest first. */
export function legalQuantities(standing: BidLike | null, total: number, wild: boolean): number[] {
  const out: number[] = [];
  for (let q = 1; q <= total; q++) {
    if (facesAt(q, standing, total, wild).some((f) => f.legal)) out.push(q);
  }
  return out;
}

/**
 * The bid the picker starts on: the smallest legal raise — the standing
 * quantity at the next face up if there is one, else one more die at the
 * lowest face; an opening bid is one of the lowest biddable face.
 */
export function defaultBid(standing: BidLike | null, total: number, wild: boolean): BidLike | null {
  for (const q of legalQuantities(standing, total, wild)) {
    const f = facesAt(q, standing, total, wild).find((x) => x.legal);
    if (f) return { quantity: q, face: f.face };
  }
  return null;
}

/** Whether a die counts towards `face`: that face, or a one when ones are wild. */
export function counts(die: number, face: number, wild: boolean): boolean {
  return die === face || (wild && die === 1);
}

/** "four 3s", "one 6" — the bid as a sentence. */
export function bidWords(b: BidLike): string {
  const n = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][b.quantity] ?? String(b.quantity);
  return `${n} ${b.face}${b.quantity === 1 ? '' : 's'}`;
}

export type WirePlayer = WireRoom['players'][number];

/** A player's display name from the room, or "Someone". */
export function nameOf(room: Pick<WireRoom, 'players'>, id: string | null | undefined): string {
  return room.players.find((p) => p.id === id)?.name ?? 'Someone';
}
