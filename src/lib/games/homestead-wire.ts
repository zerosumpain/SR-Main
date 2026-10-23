// Homestead's wire: what one phone may see of the room. Hidden information —
// other players' resource cards, everyone's unplayed almanac cards, the deck
// order, the generator, which card a steal took — never leaves `toWire`
// except to the one player it belongs to. Re-exported by `homestead.ts`.

import {
  RESOURCES,
  type Resource,
} from './homestead-board';
import {
  CARD_KINDS,
  COLOURS,
  COSTS,
  LOG_SEND,
  about,
  activePlayer,
  byId,
  cottageSpots,
  covers,
  find,
  foxHexes,
  handCount,
  heirlooms,
  log,
  openBuilding,
  publicVp,
  rates,
  roadSpots,
  setupRoadSpots,
  standings,
  totalVp,
  townSpots,
  trailLength,
  victimsAt,
  winners,
  type CardKind,
  type Piece,
  type Player,
  type Room,
} from './homestead-model';

// ---- The wire ---------------------------------------------------------------------------

const TIPS = [
  'A town makes two of everything its cottage made.',
  'Numbers with more dots come up more often: 6 and 8 most of all.',
  'A harbour lets you trade with the bank for less.',
  'Rangers move the fox — three of them make you Chief Ranger.',
  'Five roads in a row can win you the Longest Trail.',
  'Trading with the others is often better than trading with the bank.',
];

function affordable(room: Room, p: Player): (Piece | 'card')[] {
  const out: (Piece | 'card')[] = [];
  for (const k of ['road', 'cottage', 'town'] as Piece[]) if (p.pieces[k] > 0 && covers(p.hand, COSTS[k])) out.push(k);
  if (room.deck.length && covers(p.hand, COSTS.card)) out.push('card');
  return out;
}

/** Bank trades that would let `p` afford something they nearly can, best first. */
function suggestedTrades(room: Room, p: Player): { give: Resource; count: number; get: Resource; for: Piece | 'card' }[] {
  const out: { give: Resource; count: number; get: Resource; for: Piece | 'card' }[] = [];
  const r = rates(room, p.id);
  for (const target of ['town', 'cottage', 'card', 'road'] as (Piece | 'card')[]) {
    if (target !== 'card' && p.pieces[target] <= 0) continue;
    const cost = COSTS[target];
    const missing = RESOURCES.filter((x) => p.hand[x] < (cost[x] ?? 0));
    if (missing.length !== 1 || p.hand[missing[0]] + 1 < (cost[missing[0]] ?? 0)) continue;
    const get = missing[0];
    if (room.bank[get] < 1) continue;
    const give = RESOURCES.find((x) => x !== get && p.hand[x] - (cost[x] ?? 0) >= r[x]);
    if (give) out.push({ give, count: r[give], get, for: target });
    if (out.length >= 3) break;
  }
  return out;
}

/** The viewer's own options right now. */
function legalFor(room: Room, p: Player | null) {
  const none = {
    road: [] as string[],
    cottage: [] as string[],
    town: [] as string[],
    fox: [] as string[],
    victims: {} as Record<string, string[]>,
    canRoll: false,
    canBuy: false,
    canEnd: false,
    playable: [] as CardKind[],
    canTrade: false,
  };
  if (!p || room.phase !== 'playing' || p.status !== 'joined' || p.seat === null) return none;
  const isActive = room.seats[room.active] === p.id;
  const out = { ...none };
  switch (room.step) {
    case 'setup':
      if (!isActive) break;
      if (room.setupNeed === 'cottage') out.cottage = cottageSpots(room, p, true);
      else out.road = setupRoadSpots(room);
      break;
    case 'roll':
      if (!isActive) break;
      out.canRoll = true;
      break;
    case 'fox':
      if (!isActive) break;
      out.fox = foxHexes(room, p.id);
      for (const h of out.fox) {
        const v = victimsAt(room, p.id, h);
        if (v.length) out.victims[h] = v;
      }
      break;
    case 'roads':
      if (isActive && p.pieces.road > 0) out.road = roadSpots(room, p);
      break;
    case 'main':
      if (!isActive && !openBuilding(room)) break;
      if (p.pieces.road > 0 && covers(p.hand, COSTS.road)) out.road = roadSpots(room, p);
      if (p.pieces.cottage > 0 && covers(p.hand, COSTS.cottage)) out.cottage = cottageSpots(room, p);
      if (p.pieces.town > 0 && covers(p.hand, COSTS.town)) out.town = townSpots(room, p);
      out.canBuy = room.deck.length > 0 && covers(p.hand, COSTS.card);
      out.canEnd = isActive;
      out.canTrade = isActive;
      break;
  }
  if (isActive && !room.playedCardThisTurn && (room.step === 'roll' || room.step === 'main')) {
    const kinds = new Set(p.cards.filter((c) => c.boughtTurn !== room.turn && c.kind !== 'heirloom').map((c) => c.kind));
    out.playable = CARD_KINDS.filter((k) => kinds.has(k) && (room.step === 'main' || k === 'ranger'));
  }
  return out;
}

/**
 * The room as one player's phone sees it. Hidden: other players' cards (counts
 * only), unplayed almanac cards (mine listed for me), the deck order, the
 * generator, and what a steal took (thief and victim only).
 */
export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === 'finished';
  const meP = byId(room, meId);
  const seated = meP && meP.seat !== null ? meP : null;
  const active = activePlayer(room);
  const hintsLevel = room.difficulty === 'easy' ? 'full' : room.difficulty === 'medium' ? 'affordable' : null;
  const hints =
    seated && hintsLevel && room.phase === 'playing'
      ? {
          affordable: affordable(room, seated),
          trades: hintsLevel === 'full' ? suggestedTrades(room, seated) : [],
          tip: hintsLevel === 'full' ? TIPS[room.turn % TIPS.length] : null,
        }
      : null;
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    step: room.phase === 'playing' ? room.step : null,
    hostId: room.hostId,
    meId,
    pace: room.pace,
    deadlineHours: room.deadlineHours,
    vpTarget: room.vpTarget,
    island: room.island,
    rule: about(room),
    turn: room.turn,
    activeId: active?.id ?? null,
    phaseEndsAt: room.phaseEndsAt,
    startedAt: room.startedAt,
    board: room.board
      ? {
          hexes: room.board.hexes.map((h) => ({
            id: h.id,
            q: h.q,
            r: h.r,
            kind: h.kind,
            ...(h.resource ? { resource: h.resource } : {}),
            token: h.token,
            pips: h.pips,
          })),
          harbours: room.board.harbours.map((h) => ({ edge: h.edge, kind: h.kind, rate: h.rate })),
        }
      : null,
    fox: room.fox,
    buildings: Object.entries(room.buildings)
      .map(([at, b]) => ({ at, owner: b.owner, piece: b.piece }))
      .sort((a, b) => (a.at < b.at ? -1 : 1)),
    roads: Object.entries(room.roads)
      .map(([at, owner]) => ({ at, owner }))
      .sort((a, b) => (a.at < b.at ? -1 : 1)),
    seats: [...room.seats],
    dice: room.dice ? { ...room.dice } : null,
    setup:
      room.phase === 'playing' && room.step === 'setup'
        ? { round: room.setupIndex < room.seats.length ? 1 : 2, need: room.setupNeed, cottage: room.setupCottage }
        : null,
    freeRoads: room.freeRoads,
    discardOwed: { ...room.discardOwed },
    me: seated
      ? {
          hand: { ...seated.hand },
          cards: seated.cards.map((c) => ({ kind: c.kind, new: c.boughtTurn === room.turn })),
          vp: totalVp(room, seated.id),
          playedCardThisTurn: room.seats[room.active] === seated.id ? room.playedCardThisTurn : false,
          rates: rates(room, seated.id),
        }
      : null,
    legal: legalFor(room, seated),
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      seat: p.seat,
      colour: p.seat === null ? null : COLOURS[p.seat],
      handCount: handCount(p.hand),
      cardCount: p.cards.length,
      rangersPlayed: p.rangersPlayed,
      publicVp: publicVp(room, p.id),
      trail: trailLength(room, p.id),
      longestTrail: room.longestTrailId === p.id,
      chiefRanger: room.chiefRangerId === p.id,
      pieces: { ...p.pieces },
      away: p.away,
      ...(finished ? { heirlooms: heirlooms(p), vp: totalVp(room, p.id) } : {}),
    })),
    bank: { ...room.bank },
    deckCount: room.deck.length,
    costs: COSTS,
    showCosts: room.difficulty !== 'hard',
    offers: room.offers.map((o) => ({
      id: o.id,
      from: o.from,
      to: o.to ? [...o.to] : null,
      give: { ...o.give },
      want: { ...o.want },
      status: o.status,
      refusedBy: [...o.refusedBy],
      counterTo: o.counterTo,
      acceptedBy: o.acceptedBy,
      at: o.at,
    })),
    hints,
    log: room.log.slice(-LOG_SEND).map((e) => ({
      n: e.n,
      at: e.at,
      kind: e.kind,
      by: e.by,
      text: e.secret?.[meId] ?? e.text,
      auto: e.auto,
    })),
    result: room.result ? { ...room.result } : null,
    standings: finished ? standings(room) : null,
    winnerIds: finished ? winners(room) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
