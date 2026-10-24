// The friendly moves aimed at another town (WP3, spec §6.8, §8.6, §8.7,
// §9.10, A20): gifts, aid, adverts, pranks and their replies, guestbook
// stamps, festival bids, and a mayor's own holiday.
//
// None of them can hurt the town they are aimed at, and none of them reaches
// it before the next Regional Day (A20). The sender's own town pays at once
// (gift and aid coins go into escrow, an advert's fee too); the move then
// sits in the county outbox, and the Regional Day delivers it: coins at step
// 2, everything else at step 6, and an advert's or a stamp's effect in the
// flows fixed at step 4 for the day after. That is what keeps a town's day
// a function of its own state, its own moves and the snapshot, so towns can
// be stepped in any order.
//
// Caps keep a parent from quarterbacking a child (§8.12): one gift a day
// from each sender to each recipient, one prank a week, and adverts per pair
// per week by the county's rivalry setting.

import { GIFTS, PRANKS } from './content';
import { calendarMonth, MS_DAY } from './clock';
import { lineIndex } from './core';
import { byRivalry } from './params';
import { idFor, isActive, monthsToday, pair, payIntoEscrow, regionOf, rp, touch } from './region-state';
import { EngineError, type Command, type CommandResult, type CountyState, type Delivery, type SeatId } from './types';

function target(c: CountyState, i: number, to: unknown): number {
  const j = typeof to === 'number' && Number.isInteger(to) ? to : -1;
  if (j < 0 || j >= c.towns.length) throw new EngineError(400, 'Pick one of the other towns.');
  if (j === i) throw new EngineError(400, 'That is your own town.');
  if (c.towns[j].archived) throw new EngineError(409, 'That town is resting now.');
  return j;
}

function townOfSeat(c: CountyState, seat: SeatId): number {
  return c.towns.findIndex((t) => t.seat === seat);
}

function queue(c: CountyState, d: Omit<Delivery, 'day'>): void {
  regionOf(c).outbox.push({ ...d, day: c.dayIndex });
  touch(c, d.from, d.to);
}

const sentToday = (c: CountyState, kind: Delivery['kind'], i: number, j: number): number =>
  regionOf(c).outbox.filter((d) => d.kind === kind && d.from === i && d.to === j && d.day === c.dayIndex).length;

const TIER_TOWN = 2;

export function giftMove(c: CountyState, i: number, cmd: Command): CommandResult {
  if (cmd.type !== 'gift') throw new EngineError(400, 'That move is not one this game knows.');
  const t = c.towns[i];
  const j = target(c, i, cmd.to);
  const item = cmd.item;
  if (!(GIFTS as readonly string[]).includes(item)) throw new EngineError(400, 'Pick a gift from the list.');
  if (item === 'bandstand' && t.tier < TIER_TOWN) throw new EngineError(409, 'A bandstand needs your town to be a Town.');
  if (sentToday(c, 'gift', i, j) >= rp(c).giftsPerDay) throw new EngineError(409, 'One gift a day to each town: send another tomorrow.');
  let coins = 0;
  if (item === 'coins') {
    // 1% of last month's revenue, at most £10,000 (§6.8).
    coins = Math.min(rp(c).giftCoinMax, Math.floor(rp(c).giftCoinShare * (t.civicMemo?.revenue ?? 0)));
    if (coins < 1) throw new EngineError(409, 'Coins come from last month’s takings: try again after pay day.');
    if (t.money.reserves < coins) throw new EngineError(409, 'Your money box is too low for coins today.');
    payIntoEscrow(c, i, coins, 'giftCoins');
  }
  queue(c, { id: idFor(c, 'gift', i), kind: 'gift', from: i, to: j, item, amount: coins });
  return { ok: true, atTick: t.tick, cost: coins };
}

const AID_KINDS = ['coins', 'goods', 'fireCrew'] as const;

export function aidMove(c: CountyState, i: number, cmd: Command): CommandResult {
  if (cmd.type !== 'aid') throw new EngineError(400, 'That move is not one this game knows.');
  const t = c.towns[i];
  const j = target(c, i, cmd.to);
  const kind = cmd.kind as (typeof AID_KINDS)[number];
  if (!AID_KINDS.includes(kind)) throw new EngineError(400, 'Send coins, goods or a fire crew.');
  if (sentToday(c, 'aid', i, j) >= 1) throw new EngineError(409, 'You have already helped that town today.');
  let amount = 0;
  if (kind === 'coins') {
    amount = Math.floor(Number(cmd.amount));
    const most = Math.floor(rp(c).aidShare * Math.max(0, t.money.reserves));
    if (!(amount >= 1)) throw new EngineError(400, 'Choose how many coins to send.');
    if (amount > most) throw new EngineError(409, `You can send up to £${most} (a tenth of your reserves).`);
    payIntoEscrow(c, i, amount, 'aid');
  } else if (kind === 'goods') {
    amount = Math.floor(Number(cmd.amount));
    if (!(amount >= 1)) throw new EngineError(400, 'Choose how many goods to send.');
    if (amount > Math.floor(t.goodsStock[0])) throw new EngineError(409, 'You do not have that many goods in stock.');
    // The goods leave the sender's stock now and arrive at the Regional Day (no goods appear or vanish).
    t.goodsStock[0] -= amount;
  }
  queue(c, { id: idFor(c, 'aid', i), kind: 'aid', from: i, to: j, item: kind, amount });
  return { ok: true, atTick: t.tick, cost: kind === 'coins' ? amount : 0 };
}

/** An advert's fee (§8.6): one month of the town's business-tax takings, at least £20,000. */
export function advertCost(c: CountyState, i: number): number {
  const t = c.towns[i];
  const months = Math.max(1, monthsToday(c, i));
  const biz = Math.max(0, t.books.dayLines[lineIndex('businessTax')] ?? 0) / months;
  return Math.max(rp(c).advertMin, Math.round(biz));
}

export function advertMove(c: CountyState, i: number, cmd: Command): CommandResult {
  if (cmd.type !== 'advert') throw new EngineError(400, 'That move is not one this game knows.');
  const t = c.towns[i];
  const j = target(c, i, cmd.target);
  const k = cmd.cohort;
  if (!(Number.isInteger(k) && k >= 0 && k < 10)) throw new EngineError(400, 'Pick who the advert is for.');
  if (t.tier < TIER_TOWN) throw new EngineError(409, 'Advert campaigns need your town to be a Town.');
  const g = regionOf(c);
  const most = byRivalry(rp(c).advertsPerWeek, c.settings.rivalry);
  if ((g.adverts[pair(i, j)] ?? 0) >= most) throw new EngineError(409, `You can advertise to that town ${most === 1 ? 'once' : `${most} times`} a week.`);
  if (t.initiatives < 1) throw new EngineError(409, 'An advert takes a Mayor’s Initiative: a new one comes tomorrow.');
  const fee = advertCost(c, i);
  if (t.money.reserves < fee) throw new EngineError(409, `An advert costs £${fee}: save up a little first.`);
  t.initiatives -= 1;
  payIntoEscrow(c, i, fee, 'other');
  g.adverts[pair(i, j)] = (g.adverts[pair(i, j)] ?? 0) + 1;
  queue(c, { id: idFor(c, 'advert', i), kind: 'advert', from: i, to: j, item: String(k), amount: fee });
  return { ok: true, atTick: t.tick, cost: fee };
}

export function prankMove(c: CountyState, i: number, cmd: Command, now: number): CommandResult {
  if (cmd.type !== 'prank') throw new EngineError(400, 'That move is not one this game knows.');
  const t = c.towns[i];
  const j = target(c, i, cmd.to);
  const kind = cmd.kind;
  if (!(PRANKS as readonly string[]).includes(kind)) throw new EngineError(400, 'Pick a prank from the list.');
  if (c.settings.perSeat[c.towns[j].seat]?.pranks === false) throw new EngineError(409, 'Pranks are switched off for that town.');
  if (c.settings.perSeat[t.seat]?.pranks === false) throw new EngineError(409, 'Pranks are switched off for your town.');
  // The giant snowman comes out in a real December only (§6.8).
  if (kind === 'snowman' && calendarMonth(now) !== 11) throw new EngineError(409, 'The giant snowman only comes out in December.');
  const g = regionOf(c);
  if ((g.pranks[pair(i, j)] ?? 0) >= rp(c).pranksPerWeek) throw new EngineError(409, 'One prank a week to each town: save the next one!');
  g.pranks[pair(i, j)] = (g.pranks[pair(i, j)] ?? 0) + 1;
  queue(c, { id: idFor(c, 'prank', i), kind: 'prank', from: i, to: j, item: kind, amount: 0 });
  return { ok: true, atTick: t.tick, cost: 0 };
}

const REPLIES = ['keep', 'display', 'bow'] as const;

export function prankReplyMove(c: CountyState, i: number, cmd: Command): CommandResult {
  if (cmd.type !== 'prankReply') throw new EngineError(400, 'That move is not one this game knows.');
  const t = c.towns[i];
  const item = t.inbox.find((x) => x.id === cmd.id && x.kind === 'prank');
  if (!item) throw new EngineError(404, 'That prank is not in your inbox.');
  const choice = cmd.choice as (typeof REPLIES)[number];
  if (!REPLIES.includes(choice)) throw new EngineError(400, 'Keep it, display it, or send it back with a bow.');
  if (item.data.reply) throw new EngineError(409, 'You have already answered that one.');
  item.data.reply = choice;
  // Sending it back with a bow goes to the prankster at the next Regional Day.
  if (choice === 'bow' && item.from !== null && item.from >= 0 && item.from < c.towns.length && !c.towns[item.from].archived)
    queue(c, { id: idFor(c, 'prankReply', i), kind: 'prankReply', from: i, to: item.from, item: String(item.data.prank ?? ''), amount: 0 });
  return { ok: true, atTick: t.tick, cost: 0 };
}

/**
 * The guestbook's stickers (§9.10): preset reactions, each a key the app
 * draws and words itself. A stamp carries only one of these keys, never
 * anything typed, because it lands in another family member's guestbook and
 * inbox (§9.10: no free text from children; messages are preset phrases and
 * stickers) and would outlive its sender's erasure there.
 */
export const STICKERS = ['star', 'heart', 'thumbsUp', 'wow', 'smile', 'flower', 'rainbow', 'sunshine', 'trophy', 'lovelyTown', 'comeVisit', 'thankYou'] as const;
export type Sticker = (typeof STICKERS)[number];

export function stampMove(c: CountyState, i: number, cmd: Command): CommandResult {
  if (cmd.type !== 'stamp') throw new EngineError(400, 'That move is not one this game knows.');
  const j = target(c, i, townOfSeat(c, cmd.seat));
  if (!(STICKERS as readonly unknown[]).includes(cmd.sticker)) throw new EngineError(400, 'Pick a sticker.');
  if (sentToday(c, 'stamp', i, j) >= 1) throw new EngineError(409, 'You have stamped that guestbook today.');
  queue(c, { id: idFor(c, 'stamp', i), kind: 'stamp', from: i, to: j, item: cmd.sticker, amount: 0 });
  return { ok: true, atTick: c.towns[i].tick, cost: 0 };
}

const FESTIVALS = ['concert', 'foodFair', 'sports'] as const;

export function bidMove(c: CountyState, i: number, cmd: Command): CommandResult {
  if (cmd.type !== 'bid') throw new EngineError(400, 'That move is not one this game knows.');
  const t = c.towns[i];
  if (t.tier < TIER_TOWN) throw new EngineError(409, 'Festival bids need your town to be a Town.');
  if (!(FESTIVALS as readonly string[]).includes(cmd.festival)) throw new EngineError(400, 'Pick a festival.');
  const g = regionOf(c);
  if (g.bids[i]) throw new EngineError(409, 'You have already bid this week.');
  if (t.initiatives < 1) throw new EngineError(409, 'A festival bid takes a Mayor’s Initiative: a new one comes tomorrow.');
  t.initiatives -= 1;
  g.bids[i] = cmd.festival;
  return { ok: true, atTick: t.tick, cost: 0 };
}

/** Holiday (§2.4, A31): at most 21 days a season; it freezes migration to and from players both ways. */
export function holidayMove(c: CountyState, i: number, cmd: Command, now: number): CommandResult {
  if (cmd.type !== 'holiday') throw new EngineError(400, 'That move is not one this game knows.');
  const t = c.towns[i];
  const g = regionOf(c);
  if (cmd.end) {
    if (t.holiday.until === null) throw new EngineError(409, 'You are not on holiday.');
    // Whole days not taken go back into this season's allowance.
    const left = Math.max(0, Math.floor((t.holiday.until - now) / MS_DAY));
    t.holiday.usedDays = Math.max(0, t.holiday.usedDays - left);
    t.holiday.until = null;
    g.holidayFrom[i] = null;
    return { ok: true, atTick: t.tick, cost: 0 };
  }
  const days = Math.floor(Number(cmd.days));
  if (!(days >= 1)) throw new EngineError(400, 'Choose how many days.');
  if (t.holiday.until !== null && t.holiday.until > now) throw new EngineError(409, 'You are already on holiday.');
  const most = rp(c).holidayDays - t.holiday.usedDays;
  if (days > most) throw new EngineError(409, most > 0 ? `You have ${most} holiday days left this season.` : 'You have used this season’s holiday days.');
  t.holiday.until = now + days * MS_DAY;
  t.holiday.usedDays += days;
  g.holidayFrom[i] = now;
  return { ok: true, atTick: t.tick, cost: 0, data: { until: t.holiday.until } };
}

/** The Council vote (§8.9): one vote per town, changeable until the question closes; abstaining is allowed. */
export function voteMove(c: CountyState, i: number, cmd: Command): CommandResult {
  if (cmd.type !== 'vote') throw new EngineError(400, 'That move is not one this game knows.');
  const q = c.council;
  if (!q.question || q.question !== cmd.question) throw new EngineError(409, 'That question is closed: see this week’s.');
  if (!isActive(c.towns[i])) throw new EngineError(409, 'Your town can vote once it is on the county clock.');
  const choice = cmd.choice;
  if (!(Number.isInteger(choice) && choice >= -1 && choice < q.options.length)) throw new EngineError(400, 'Pick one of the options.');
  while (q.votes.length < c.towns.length) q.votes.push(null);
  q.votes[i] = choice === -1 ? null : choice;
  return { ok: true, atTick: c.towns[i].tick, cost: 0 };
}

