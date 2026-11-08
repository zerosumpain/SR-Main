// Homestead's trades: the bank and harbours on your own turn, and offers
// between players (make, counter, accept, refuse, cancel). Re-exported by
// `homestead.ts`, which the registry calls.

import {
  GameError,
} from './tap-duel';
import {
  RESOURCES,
  isResource,
} from './homestead-board';
import {
  MAX_OPEN_OFFERS,
  assertActive,
  assertPlaying,
  byId,
  covers,
  find,
  handText,
  log,
  nameOf,
  parseCards,
  playing,
  present,
  rates,
  voidUncovered,
  type Hand,
  type Offer,
  type Room,
} from './homestead-model';

/** Trade with the bank: `rate` of `give` for one `get`. */
export function bank(room: Room, playerId: string, input: { give: unknown; get: unknown }, now: number): void {
  const p = assertActive(room, playerId, ['main']);
  if (!isResource(input.give) || !isResource(input.get)) throw new GameError(400, 'Pick a resource to give and one to get.');
  if (input.give === input.get) throw new GameError(400, 'Pick a different resource to get.');
  const rate = rates(room, p.id)[input.give];
  if (p.hand[input.give] < rate) throw new GameError(409, `You need ${rate} ${input.give} to trade.`);
  if (room.bank[input.get] < 1) throw new GameError(409, `The bank has no ${input.get} left.`);
  present(room, p, now);
  p.hand[input.give] -= rate;
  room.bank[input.give] += rate;
  room.bank[input.get] -= 1;
  p.hand[input.get] += 1;
  log(room, now, 'bank', p.id, `${p.name} traded ${rate} ${input.give} with the bank for 1 ${input.get}.`);
  room.updatedAt = now;
  voidUncovered(room);
}

function parseTrade(give: unknown, want: unknown): { give: Partial<Hand>; want: Partial<Hand> } {
  const g = parseCards(give, 'give');
  const w = parseCards(want, 'ask for');
  if (RESOURCES.some((r) => g[r] && w[r])) throw new GameError(400, "Don't put the same resource on both sides.");
  return { give: g, want: w };
}

function openOffer(room: Room, id: unknown): Offer {
  const o = room.offers.find((x) => x.id === id);
  if (!o || o.status !== 'open') throw new GameError(409, 'That offer has gone.');
  return o;
}

const isRecipient = (o: Offer, id: string) => o.from !== id && (o.to === null || o.to.includes(id));

/** The active player offers a trade to everyone or to named players. */
export function offer(room: Room, playerId: string, input: { give: unknown; want: unknown; to?: unknown }, now: number): void {
  const p = assertActive(room, playerId, ['main']);
  const { give, want } = parseTrade(input.give, input.want);
  let to: string[] | null = null;
  if (input.to != null) {
    if (!Array.isArray(input.to)) throw new GameError(400, 'Say who the offer is for.');
    const others = playing(room).filter((q) => q.id !== p.id).map((q) => q.id);
    const ids = [...new Set(input.to)];
    if (!ids.every((x): x is string => typeof x === 'string' && others.includes(x))) {
      throw new GameError(400, 'You can only offer to players in this game.');
    }
    to = ids.length ? ids : null;
  }
  if (!covers(p.hand, give)) throw new GameError(409, "You don't have those cards.");
  if (room.offers.filter((o) => o.status === 'open' && o.from === p.id).length >= MAX_OPEN_OFFERS) {
    throw new GameError(409, `You can have ${MAX_OPEN_OFFERS} offers open at once.`);
  }
  present(room, p, now);
  const o: Offer = { id: `o${room.nextOffer++}`, from: p.id, to, give, want, status: 'open', refusedBy: [], counterTo: null, acceptedBy: null, at: now };
  room.offers.push(o);
  log(room, now, 'offer', p.id, `${p.name} offers ${handText(give)} for ${handText(want)}${to ? ` to ${to.map((id) => nameOf(room, id)).join(' and ')}` : ''}.`);
  room.updatedAt = now;
}

/** A recipient answers the active player's offer with their own terms. */
export function counter(room: Room, playerId: string, input: { offerId: unknown; give: unknown; want: unknown }, now: number): void {
  const p = assertPlaying(room, playerId);
  if (room.step !== 'main') throw new GameError(409, 'Trading happens in the main part of a turn.');
  const active = room.seats[room.active];
  const o = openOffer(room, input.offerId);
  if (o.from !== active || !isRecipient(o, p.id)) throw new GameError(409, 'You can only counter an offer made to you.');
  const { give, want } = parseTrade(input.give, input.want);
  if (!covers(p.hand, give)) throw new GameError(409, "You don't have those cards.");
  if (room.offers.some((x) => x.status === 'open' && x.from === p.id && x.counterTo === o.id)) {
    throw new GameError(409, 'You already have a counter-offer open on that one.');
  }
  present(room, p, now);
  room.offers.push({ id: `o${room.nextOffer++}`, from: p.id, to: [active], give, want, status: 'open', refusedBy: [], counterTo: o.id, acceptedBy: null, at: now });
  log(room, now, 'offer', p.id, `${p.name} counters: ${handText(give)} for ${handText(want)}.`);
  room.updatedAt = now;
}

/** Take an offer: the trade happens at once. */
export function accept(room: Room, playerId: string, input: { offerId: unknown }, now: number): void {
  const p = assertPlaying(room, playerId);
  if (room.step !== 'main') throw new GameError(409, 'Trading happens in the main part of a turn.');
  const o = openOffer(room, input.offerId);
  const active = room.seats[room.active];
  // Every trade has the active player on one side.
  if (!isRecipient(o, p.id) || (o.from !== active && p.id !== active)) throw new GameError(409, "That offer isn't for you.");
  const from = byId(room, o.from)!;
  if (from.status !== 'joined' || !covers(from.hand, o.give)) throw new GameError(409, `${from.name} no longer has those cards.`);
  if (!covers(p.hand, o.want)) throw new GameError(409, "You don't have the cards they want.");
  present(room, p, now);
  for (const r of RESOURCES) {
    const g = o.give[r] ?? 0;
    const w = o.want[r] ?? 0;
    from.hand[r] += w - g;
    p.hand[r] += g - w;
  }
  o.status = 'done';
  o.acceptedBy = p.id;
  log(room, now, 'trade', p.id, `${from.name} traded ${handText(o.give)} to ${p.name} for ${handText(o.want)}.`);
  room.updatedAt = now;
  voidUncovered(room);
}

/** A recipient says no to an offer. */
export function refuse(room: Room, playerId: string, input: { offerId: unknown }, now: number): void {
  const p = assertPlaying(room, playerId);
  const o = openOffer(room, input.offerId);
  if (!isRecipient(o, p.id)) throw new GameError(409, "That offer isn't for you.");
  present(room, p, now);
  if (!o.refusedBy.includes(p.id)) o.refusedBy.push(p.id);
  // An offer to named players that all of them refused is over.
  if (o.to && o.to.every((id) => o.refusedBy.includes(id))) o.status = 'cancelled';
  room.updatedAt = now;
}

/** The proposer withdraws an offer. */
export function cancel(room: Room, playerId: string, input: { offerId: unknown }, now: number): void {
  const p = assertPlaying(room, playerId);
  const o = openOffer(room, input.offerId);
  if (o.from !== p.id) throw new GameError(409, 'Only the player who made an offer can cancel it.');
  present(room, p, now);
  o.status = 'cancelled';
  room.updatedAt = now;
}
