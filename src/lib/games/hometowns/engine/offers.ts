// Offers between players (WP3, spec §8.2, §8.7, A20, A30): links, contracts,
// shared places, pacts and ribbon-cutting invitations, and the life of each.
//
// The shape is the same for all of them. One mayor's move makes an offer
// (and, for a link, pays its share into escrow at once); the other answers
// with a move of their own. Neither move touches the other town: an answer
// is written on the offer, and everything it causes (a refund, a contract
// starting, a pact, the builder being paid) happens at the next Regional Day
// (A20). An unanswered offer lasts 8 Regional Days (A30), so a mayor who
// plays once a week can still answer anything a daily player sent; when it
// lapses, the proposer gets back whatever they paid.
//
// Links have a little more life: an accepted link waits until each side's
// road reaches its own signpost (a ring neighbour's facing one; anyone else
// meets via Kingsport, where the County Road always arrives) and opens at
// the first Regional Day after both are connected. Closing takes 7 days'
// notice. A bus service runs on an open road link and costs £8,000 a month,
// split, paid to Kingsport.

import { LINKS } from './content';
import { hasBuildingDone } from './trade';
import { renewsContracts } from './orders';
import { roadNetOf, SIGNPOSTS } from './space';
import {
  countKind,
  escrowToKingsport,
  idFor,
  inboxNote,
  isActive,
  linkMinutes,
  monthsToday,
  payFromEscrow,
  payIntoEscrow,
  payKingsport,
  pp,
  regionOf,
  ringNeighbours,
  rp,
  touch,
} from './region-state';
import {
  EngineError,
  type Actor,
  type Command,
  type CommandResult,
  type Contract,
  type CountyState,
  type Link,
  type Offer,
  type RegionalContext,
  type TownState,
} from './types';

const RAIL_COST_SEASON = 0.7;

function cost(c: CountyState, kind: Link['kind']): number {
  const def = LINKS.find((l) => l.id === kind)!;
  const rail = c.season.theme === 'ageOfRail' && (kind === 'rail' || kind === 'road');
  return Math.round(def.cost * (rail ? RAIL_COST_SEASON : 1));
}

function linkTier(c: CountyState, kind: Link['kind']): number {
  const def = LINKS.find((l) => l.id === kind)!;
  // Age of Rail: rail links unlock at Town (§8.10).
  return kind === 'rail' && c.season.theme === 'ageOfRail' ? 2 : def.tier;
}

const TIER_WORDS = ['a Hamlet', 'a Village', 'a Town', 'a City', 'a Metropolis'];

/** A linked town index from a move body, or a polite refusal. */
function otherTown(c: CountyState, i: number, to: unknown): number {
  const j = typeof to === 'number' && Number.isInteger(to) ? to : -1;
  if (j < 0 || j >= c.towns.length) throw new EngineError(400, 'Pick one of the other towns.');
  if (j === i) throw new EngineError(400, 'That is your own town.');
  if (c.towns[j].archived) throw new EngineError(409, 'That town is resting now.');
  return j;
}

function offerFor(c: CountyState, id: string): Offer {
  const o = c.offers.find((x) => x.id === id);
  if (!o) throw new EngineError(404, 'That offer is no longer open.');
  return o;
}

/** A30: an offer can be answered on any day before its 8th Regional Day has run. */
export function offerOpen(c: CountyState, o: Offer): boolean {
  return c.dayIndex < o.expiresDay && o.body.answer === undefined;
}

function newOffer(c: CountyState, kind: Offer['kind'], from: number, to: number, id: string, body: Record<string, unknown>): Offer {
  const o: Offer = { id, kind, from, to, body, madeDay: c.dayIndex, expiresDay: c.dayIndex + pp(c).social.offerDays };
  c.offers.push(o);
  return o;
}

function answerOffer(c: CountyState, i: number, id: string, yes: boolean, kind: Offer['kind']): Offer {
  const o = offerFor(c, id);
  if (o.kind !== kind) throw new EngineError(404, 'That offer is no longer open.');
  if (o.to !== i) throw new EngineError(403, 'That offer was made to another town.');
  if (!offerOpen(c, o)) throw new EngineError(409, 'That offer has already been answered or has run out.');
  o.body.answer = yes ? 'yes' : 'no';
  return o;
}

const done = (t: TownState, spent = 0, data?: Record<string, unknown>): CommandResult => ({ ok: true, atTick: t.tick, cost: spent, ...(data ? { data } : {}) });

// ---- Links -----------------------------------------------------------------------------------------

function pairHas(c: CountyState, kind: Link['kind'], i: number, j: number, states: Link['state'][]): Link | undefined {
  return c.links.find((l) => l.kind === kind && ((l.a === i && l.b === j) || (l.a === j && l.b === i)) && states.includes(l.state));
}

const RAIL_STATION = 'railStation';

/** The link move (§10.6): propose, answer or close. */
export function linkMove(c: CountyState, i: number, cmd: Command, _actor: Actor): CommandResult {
  if (cmd.type !== 'link') throw new EngineError(400, 'That move is not one this game knows.');
  const t = c.towns[i];
  if (cmd.propose) {
    const j = otherTown(c, i, cmd.propose.to);
    const kind = cmd.propose.kind;
    if (kind !== 'road' && kind !== 'bus' && kind !== 'rail') throw new EngineError(400, 'Choose a road link, a bus service or a railway.');
    const tier = linkTier(c, kind);
    if (t.tier < tier) throw new EngineError(409, `A ${kind === 'road' ? 'road link' : kind === 'bus' ? 'bus service' : 'railway'} needs your town to be ${TIER_WORDS[tier]}.`);
    if (pairHas(c, kind, i, j, ['proposed', 'waiting', 'open', 'closing'])) throw new EngineError(409, 'You already have that link, or it is on its way.');
    if (kind === 'bus' && !pairHas(c, 'road', i, j, ['open'])) throw new EngineError(409, 'A bus service runs on an open road link: build the road first.');
    if (kind === 'rail' && !hasBuildingDone(t, RAIL_STATION)) throw new EngineError(409, 'A railway needs a Rail Station in your town first.');
    const share = typeof cmd.propose.share === 'number' && Number.isFinite(cmd.propose.share) ? Math.min(1, Math.max(0.5, cmd.propose.share)) : 0.5;
    const total = cost(c, kind);
    const mine = Math.round(total * share);
    if (t.money.reserves < mine) throw new EngineError(409, `Your share is £${mine}: save up a little first.`);
    const id = idFor(c, 'link', i);
    payIntoEscrow(c, i, mine, 'capital');
    c.links.push({ id, kind, a: i, b: j, state: 'proposed', proposedDay: c.dayIndex, openedDay: null, closeDay: null, paid: [mine, 0], minutes: linkMinutes(c, kind, i, j) });
    newOffer(c, 'link', i, j, id, { link: id, cost: total });
    touch(c, i, j);
    return done(t, mine, { offer: id });
  }
  if (cmd.answer) {
    const o = offerFor(c, cmd.answer.id);
    const l = c.links.find((x) => x.id === o.id);
    if (!l) throw new EngineError(404, 'That offer is no longer open.');
    if (cmd.answer.yes) {
      if (l.kind === 'rail' && !hasBuildingDone(t, RAIL_STATION)) throw new EngineError(409, 'A railway needs a Rail Station in your town first.');
      if (t.tier < linkTier(c, l.kind)) throw new EngineError(409, `That link needs your town to be ${TIER_WORDS[linkTier(c, l.kind)]}.`);
      const theirs = Math.max(0, cost(c, l.kind) - l.paid[0]);
      if (t.money.reserves < theirs) throw new EngineError(409, `Your share is £${theirs}: save up a little first.`);
      answerOffer(c, i, o.id, true, 'link');
      payIntoEscrow(c, i, theirs, 'capital');
      l.paid[1] = theirs;
      touch(c, i, o.from);
      return done(t, theirs);
    }
    answerOffer(c, i, o.id, false, 'link');
    return done(t);
  }
  if (cmd.close) {
    const l = c.links.find((x) => x.id === cmd.close!.id && (x.a === i || x.b === i));
    if (!l) throw new EngineError(404, 'That link is not one of yours.');
    if (l.state === 'proposed' && l.a === i) {
      const o = c.offers.find((x) => x.id === l.id);
      if (o && o.body.answer === undefined) o.body.answer = 'withdrawn';
      return done(t);
    }
    if (l.state !== 'open') throw new EngineError(409, 'Only an open link can be closed.');
    l.state = 'closing';
    l.closeDay = c.dayIndex + rp(c).closeNoticeDays;
    return done(t, 0, { closeDay: l.closeDay });
  }
  throw new EngineError(400, 'Propose, answer or close a link.');
}

/** A town's road reaches the signpost facing town j (§8.2): its own County Road always reaches Kingsport. */
export function signpostReady(c: CountyState, i: number, j: number): boolean {
  if (!ringNeighbours(c, i, j)) return true;
  const t = c.towns[i];
  const n = c.sites.length;
  // Sites run round the ring; the east signpost faces the next site, the west one the previous.
  const side = (t.site + 1) % n === c.towns[j].site ? 2 : 1;
  const net = roadNetOf(t, pp(c).develop.roadReach);
  const node = net.signNode[side];
  return node >= 0 && net.kingsportComp >= 0 && net.comp[SIGNPOSTS[side]] === net.kingsportComp;
}

/** Links whose notice has run out close; accepted ones open once both roads reach their signposts (step 4's start). */
export function advanceLinks(c: CountyState, r: RegionalContext): void {
  const closed = new Set(c.links.filter((l) => l.state === 'closing' && l.closeDay !== null && r.dayIndex >= l.closeDay).map((l) => l.id));
  // A bus rides on its road link: it goes when the road goes.
  for (const l of c.links) {
    if (l.kind !== 'bus' || closed.has(l.id)) continue;
    if (c.links.some((x) => x.kind === 'road' && closed.has(x.id) && ((x.a === l.a && x.b === l.b) || (x.a === l.b && x.b === l.a)))) closed.add(l.id);
  }
  for (const l of c.links) if (closed.has(l.id)) for (const k of [l.a, l.b]) note(c, k, r.dayIndex, 'linkClosed', { with: k === l.a ? l.b : l.a, kind: l.kind });
  c.links = c.links.filter((l) => !closed.has(l.id));
  for (const l of c.links) {
    if (l.state !== 'waiting') continue;
    const a = c.towns[l.a];
    const b = c.towns[l.b];
    if (!isActive(a) || !isActive(b)) continue;
    if (l.kind === 'bus' && !pairHas(c, 'road', l.a, l.b, ['open', 'closing'])) continue;
    if (!signpostReady(c, l.a, l.b) || !signpostReady(c, l.b, l.a)) continue;
    l.state = 'open';
    l.openedDay = r.dayIndex;
    for (const k of [l.a, l.b]) note(c, k, r.dayIndex, 'linkOpened', { with: k === l.a ? l.b : l.a, kind: l.kind });
  }
}

/** A bus service's monthly running cost, split 50/50, paid to Kingsport for the months each town ran (step 2). */
export function payBusServices(c: CountyState): void {
  const def = LINKS.find((l) => l.id === 'bus')!;
  for (const l of c.links) {
    if (l.kind !== 'bus' || (l.state !== 'open' && l.state !== 'closing')) continue;
    for (const k of [l.a, l.b]) if (isActive(c.towns[k])) payKingsport(c, k, (def.upkeep / 2) * monthsToday(c, k), 'upkeepRoads');
  }
}

// ---- Contracts (§8.7 item 3) --------------------------------------------------------------------

/** Kingsport's band for a contract item: [export, import] £ per unit (power and water, §5.14). */
export function contractBand(c: CountyState, kind: Contract['kind']): [number, number] {
  const u = pp(c).utilities;
  if (kind === 'power') return [u.exportPower, u.importPower];
  if (kind === 'water') return [u.exportWater, u.importWater];
  return [rp(c).freightPerJob, rp(c).freightPerJob];
}

export function contractMove(c: CountyState, i: number, cmd: Command, actor: Actor): CommandResult {
  if (cmd.type !== 'contract') throw new EngineError(400, 'That move is not one this game knows.');
  const t = c.towns[i];
  if (cmd.offer) {
    if (c.settings.perSeat[actor.seat]?.answerOnly) throw new EngineError(403, 'You can answer contracts, and a grown-up can make new ones.');
    const b = cmd.offer;
    const j = otherTown(c, i, b.to);
    const kind = b.item as Contract['kind'];
    if (kind !== 'power' && kind !== 'water' && kind !== 'freight') throw new EngineError(400, 'A contract is for power, water or freight.');
    if (t.tier < (kind === 'freight' ? 2 : 1)) throw new EngineError(409, `A ${kind} contract needs your town to be ${kind === 'freight' ? 'a Town' : 'a Village'}.`);
    const role = b.role === 'buy' ? 'buy' : 'sell';
    const amount = typeof b.amount === 'number' && Number.isFinite(b.amount) ? Math.floor(b.amount) : 0;
    if (amount < 1 || amount > 1_000_000) throw new EngineError(400, 'Choose how much a month.');
    const [lo, hi] = contractBand(c, kind);
    const price = kind === 'freight' ? lo : typeof b.price === 'number' && Number.isFinite(b.price) ? b.price : NaN;
    if (!(price >= lo && price <= hi)) throw new EngineError(400, `The price must sit between Kingsport's £${lo} and £${hi} a unit.`);
    const [w0, w1] = rp(c).contractWeeks;
    const weeks = typeof b.weeks === 'number' && Number.isInteger(b.weeks) ? b.weeks : w0;
    if (weeks < w0 || weeks > w1) throw new EngineError(400, `A contract runs ${w0} to ${w1} weeks.`);
    if (!c.links.some((l) => (l.state === 'open' || l.state === 'closing') && ((l.a === i && l.b === j) || (l.a === j && l.b === i)))) throw new EngineError(409, 'Contracts travel along links: connect your towns first.');
    const id = idFor(c, 'contract', i);
    newOffer(c, 'contract', i, j, id, { kind, seller: role === 'sell' ? i : j, buyer: role === 'sell' ? j : i, amount, price, weeks });
    touch(c, i, j);
    return done(t, 0, { offer: id });
  }
  if (cmd.answer) {
    answerOffer(c, i, cmd.answer.id, cmd.answer.yes, 'contract');
    return done(t);
  }
  if (cmd.end) {
    const k = c.contracts.find((x) => x.id === cmd.end!.id && (x.seller === i || x.buyer === i));
    if (!k) throw new EngineError(404, 'That contract is not one of yours.');
    // It ends at the next Regional Day, with no penalty: a contract just runs out (§8.7).
    // `ended` keeps it ended even when both mayors' standing orders renew contracts.
    k.endDay = Math.min(k.endDay ?? Infinity, c.dayIndex + 1);
    k.renew = false;
    k.ended = true;
    return done(t);
  }
  throw new EngineError(400, 'Offer, answer or end a contract.');
}

/** The contracts that run on the day after Regional Day `day` (snapshot.contracts, step 10). */
export function runningContracts(c: CountyState, day: number): Contract[] {
  const d = day + 1;
  return c.contracts.filter((k) => k.startDay <= d && (k.endDay === null || d < k.endDay) && isActive(c.towns[k.seller]) && isActive(c.towns[k.buyer]));
}

// ---- Shared places (§8.7 item 4) -------------------------------------------------------------------

const HOSPITAL = 'hospital';
const UNIVERSITY = 'university';

export function shareMove(c: CountyState, i: number, cmd: Command): CommandResult {
  if (cmd.type !== 'share') throw new EngineError(400, 'That move is not one this game knows.');
  const t = c.towns[i];
  if (cmd.offer) {
    const b = cmd.offer;
    if (t.tier < 3) throw new EngineError(409, 'Sharing places needs your town to be a City.');
    const service = b.service;
    if (service !== 'health' && service !== 'university') throw new EngineError(400, 'Share hospital or university places.');
    if (!hasBuildingDone(t, service === 'health' ? HOSPITAL : UNIVERSITY)) throw new EngineError(409, `You need a finished ${service === 'health' ? 'Hospital' : 'University'} to share its places.`);
    const j = otherTown(c, i, b.to);
    if (!c.links.some((l) => (l.state === 'open' || l.state === 'closing') && ((l.a === i && l.b === j) || (l.a === j && l.b === i)))) throw new EngineError(409, 'Shared places travel along links: connect your towns first.');
    const places = typeof b.places === 'number' && Number.isFinite(b.places) ? Math.floor(b.places) : 0;
    if (places < 1) throw new EngineError(400, 'Offer at least one place.');
    const fee = rp(c).sharedFees[service === 'health' ? 0 : 1];
    const price = typeof b.price === 'number' && Number.isFinite(b.price) ? Math.min(2 * fee, Math.max(0, b.price)) : fee;
    const id = idFor(c, 'share', i);
    newOffer(c, 'share', i, j, id, { service, places, price });
    touch(c, i, j);
    return done(t, 0, { offer: id });
  }
  if (cmd.answer) {
    answerOffer(c, i, cmd.answer.id, cmd.answer.yes, 'share');
    return done(t);
  }
  if (cmd.end) {
    const s = regionOf(c).shares.find((x) => x.id === cmd.end!.id && (x.provider === i || x.user === i));
    if (!s) throw new EngineError(404, 'That agreement is not one of yours.');
    s.endDay = c.dayIndex + 1;
    return done(t);
  }
  throw new EngineError(400, 'Offer or answer shared places.');
}

// ---- Pacts (§8.7 items 5–6) -----------------------------------------------------------------------

export function pactMove(c: CountyState, i: number, cmd: Command): CommandResult {
  if (cmd.type !== 'pact') throw new EngineError(400, 'That move is not one this game knows.');
  const t = c.towns[i];
  if (cmd.propose) {
    const j = otherTown(c, i, cmd.propose.to);
    const kind = cmd.propose.kind;
    if (kind !== 'trail' && kind !== 'twin') throw new EngineError(400, 'Propose a Tourist Trail or Twin Towns.');
    if (kind === 'trail' && t.tier < 2) throw new EngineError(409, 'A Tourist Trail needs your town to be a Town.');
    if (kind === 'twin' && (c.friendship[i * 6 + j] ?? 0) < rp(c).twinWeeks) throw new EngineError(409, `Twin Towns need ${rp(c).twinWeeks} friendship weeks together first.`);
    if (c.pacts.some((x) => x.kind === kind && ((x.a === i && x.b === j) || (x.a === j && x.b === i)))) throw new EngineError(409, 'You already have that pact.');
    const id = idFor(c, 'pact', i);
    newOffer(c, 'pact', i, j, id, { kind });
    touch(c, i, j);
    return done(t, 0, { offer: id });
  }
  if (cmd.answer) {
    answerOffer(c, i, cmd.answer.id, cmd.answer.yes, 'pact');
    return done(t);
  }
  if (cmd.end) {
    const x = c.pacts.find((q) => q.id === cmd.end!.id && (q.a === i || q.b === i));
    if (!x) throw new EngineError(404, 'That pact is not one of yours.');
    // Either side can dissolve it with a week's notice; there is no betrayal mechanic (§8.7).
    x.endDay = c.dayIndex + rp(c).closeNoticeDays;
    return done(t, 0, { endDay: x.endDay });
  }
  throw new EngineError(400, 'Propose, answer or end a pact.');
}

// ---- Ribbon cuttings (§8.7 item 11) -----------------------------------------------------------------

/** Invites every other active town to a town's ribbon cutting (an 8-day offer; `attend` answers it). */
export function inviteRibbon(c: CountyState, host: number, day: number, what: string): void {
  for (let j = 0; j < c.towns.length; j++) {
    if (j === host || !isActive(c.towns[j])) continue;
    const id = `ribbon.${host}.${day}.${what}.${j}`;
    if (c.offers.some((o) => o.id === id)) continue;
    c.offers.push({ id, kind: 'ribbon', from: host, to: j, body: { what }, madeDay: day, expiresDay: day + 1 + pp(c).social.offerDays });
  }
}

export function attendMove(c: CountyState, i: number, cmd: Command): CommandResult {
  if (cmd.type !== 'attend') throw new EngineError(400, 'That move is not one this game knows.');
  const o = offerFor(c, cmd.ribbonId);
  answerOffer(c, i, o.id, true, 'ribbon');
  touch(c, i, o.from);
  return done(c.towns[i]);
}

// ---- The Regional Day: answers take effect, offers lapse --------------------------------------------

function note(c: CountyState, i: number, day: number, kind: string, data: Record<string, number | string>): void {
  inboxNote(c, i, day, kind, data, typeof data.with === 'number' ? data.with : null);
}

/**
 * §8.3 step 2's offers part: each answer reaches the other town now. A link
 * accepted is paid to its builder (Kingsport) out of escrow; one declined,
 * withdrawn or lapsed refunds the proposer. Contracts and shared places
 * accepted start tomorrow; pacts begin; ribbon guests are counted. Offers
 * with no answer by their 8th Regional Day lapse (A30).
 */
export function settleOffers(c: CountyState, r: RegionalContext): void {
  const keep: Offer[] = [];
  const g = regionOf(c);
  for (const o of c.offers) {
    const answer = o.body.answer as string | undefined;
    const lapsed = answer === undefined && r.dayIndex >= o.expiresDay - 1;
    const gone = (o.from < c.towns.length && c.towns[o.from].archived) || (o.to < c.towns.length && c.towns[o.to].archived);
    if (answer === undefined && !lapsed && !gone) {
      if (r.dayIndex === o.madeDay && o.kind !== 'ribbon') note(c, o.to, r.dayIndex, 'offer', { kind: o.kind, with: o.from });
      keep.push(o);
      continue;
    }
    const yes = answer === 'yes' && !gone;
    if (o.kind === 'link') {
      const l = c.links.find((x) => x.id === o.id);
      if (l && yes) {
        escrowToKingsport(c, l.paid[0] + l.paid[1]);
        l.state = 'waiting';
        note(c, o.from, r.dayIndex, 'link', { with: o.to, kind: l.kind, answer: 'yes' });
      } else if (l) {
        // Refund whatever each side put in (the answerer pays only on a yes, so normally the proposer alone).
        payFromEscrow(c, l.a, l.paid[0], 'refunds');
        payFromEscrow(c, l.b, l.paid[1], 'refunds');
        c.links = c.links.filter((x) => x !== l);
        if (!gone) note(c, o.from, r.dayIndex, 'link', { with: o.to, kind: l.kind, answer: lapsed ? 'lapsed' : answer ?? 'no' });
      }
    } else if (o.kind === 'contract' && yes) {
      const b = o.body as { kind: Contract['kind']; seller: number; buyer: number; amount: number; price: number; weeks: number };
      const start = r.dayIndex + 1;
      c.contracts.push({ id: o.id, kind: b.kind, seller: b.seller, buyer: b.buyer, amount: b.amount, price: b.price, startDay: start, endDay: start + b.weeks * rp(c).weekDays, renew: false });
      note(c, o.from, r.dayIndex, 'contract', { with: o.to, answer: 'yes' });
    } else if (o.kind === 'share' && yes) {
      const b = o.body as { service: 'health' | 'university'; places: number; price: number };
      g.shares.push({ id: o.id, service: b.service, provider: o.from, user: o.to, places: b.places, price: b.price, startDay: r.dayIndex + 1, endDay: null });
      note(c, o.from, r.dayIndex, 'share', { with: o.to, answer: 'yes' });
    } else if (o.kind === 'pact' && yes) {
      const kind = (o.body as { kind: 'trail' | 'twin' }).kind;
      if (!c.pacts.some((x) => x.kind === kind && ((x.a === o.from && x.b === o.to) || (x.a === o.to && x.b === o.from)))) c.pacts.push({ id: o.id, kind, a: o.from, b: o.to, sinceDay: r.dayIndex });
      note(c, o.from, r.dayIndex, 'pact', { with: o.to, kind, answer: 'yes' });
    } else if (o.kind === 'ribbon' && yes) {
      // Turning up is a kind act (the Kindest Neighbour award), counted as it lands.
      countKind(c, o.to);
      note(c, o.from, r.dayIndex, 'ribbonGuest', { with: o.to });
      note(c, o.to, r.dayIndex, 'ribbonAttended', { with: o.from });
    } else if (!yes && !gone && o.kind !== 'ribbon') {
      note(c, o.from, r.dayIndex, o.kind, { with: o.to, answer: lapsed ? 'lapsed' : answer ?? 'no' });
    }
  }
  c.offers = keep;

  // Contracts that ran out: the Deputy renews them when both mayors' standing orders say so (§8.7).
  const day = r.dayIndex + 1;
  const kept: Contract[] = [];
  for (const k of c.contracts) {
    const live = isActive(c.towns[k.seller]) && isActive(c.towns[k.buyer]);
    if (k.endDay !== null && day >= k.endDay) {
      if (live && !k.ended && (k.renew || (renewsContracts(c.towns[k.seller]) && renewsContracts(c.towns[k.buyer])))) {
        const weeks = Math.max(1, Math.round((k.endDay - k.startDay) / rp(c).weekDays));
        k.startDay = day;
        k.endDay = day + weeks * rp(c).weekDays;
        kept.push(k);
      }
      continue;
    }
    kept.push(k);
  }
  c.contracts = kept;

  // Pacts whose week's notice has run out dissolve.
  c.pacts = c.pacts.filter((x) => !(typeof x.endDay === 'number' && r.dayIndex >= x.endDay));
}

/** The building id a shared place needs (for the wire's affordances). */
export const SHARE_BUILDING: Record<'health' | 'university', string> = { health: HOSPITAL, university: UNIVERSITY };
