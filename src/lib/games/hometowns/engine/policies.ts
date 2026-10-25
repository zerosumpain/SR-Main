// Policy cards (WP2d, spec §6.7): enacting and repealing them, the slots per
// tier, the Mayor's Initiative an enactment costs, painted areas, and what
// Helper Mode does to them. A card's monthly money is posted by finance.ts in
// M13; its effects are applied by the package that owns the number it
// changes, each reading t.policies (or the painted MARK_* bits):
//
//   Litter Pickers       Nature +5 (needs.ts), tourism quality (tourism.ts)
//   Neighbourhood Watch  crime ×0.92 (fields.ts), Fun −2 (needs.ts)
//   Farmers' Market      Shops meter +10 (business.ts), Fun +5 (needs.ts)
//   Smoke Alarms         incident risk −40% (develop.ts, WP2e)
//   Clean Air Rules      emissions (fields.ts), industry costs (business.ts)
//   Night Market         Fun (needs.ts), leisure spend (trade.ts), noise and crime (fields.ts)
//   Free Bus Fridays     bus share (transport.ts), fares (finance.ts)
//   Reading Challenge    education inflow (people.ts)
//   Tree Planting        pollution (fields.ts)
//   Start-up Holiday     business tax on young tiles (business.ts)
//   Short-let Limits     no conversion (housing.ts), hotel beds (tourism.ts)
//   Tourism Promotion    awareness (tourism.ts), Buzz (needs.ts)
//   Keep Homes Affordable  MARK_AFFORDABLE: rents and re-tiering (housing.ts), tax yield (finance.ts)
//   Heritage Protection  MARK_HERITAGE: culture (needs.ts), no level-ups (develop.ts, WP2e)
//   Car-Free Centre      MARK_CARFREE: noise (fields.ts), car times (transport.ts)
//   Green Energy Pledge  no coal (ops.ts), Nature and culture (needs.ts)
//
// So a card that is off leaves every system exactly as if the card did not
// exist: nothing here keeps state for a card that is not active.

import { POLICIES, POLICY_SLOTS, type PolicyDef } from './content';
import { civicMemo } from './finance';
import { paramsFor } from './params';
import { MAP, MARK_AFFORDABLE, MARK_CARFREE, MARK_HERITAGE, pairGet, pairSet, tileIndex } from './tiles';
import { EngineError, TIER_NAMES, type ActivePolicy, type Command, type CommandResult, type CountyState, type TownState } from './types';

/** The painted cards' MARK_* bit. */
const PAINT_BIT: Record<string, number> = { keepHomesAffordable: MARK_AFFORDABLE, heritageProtection: MARK_HERITAGE, carFreeCentre: MARK_CARFREE };

export function policyDef(card: string): PolicyDef | undefined {
  return POLICIES.find((d) => d.id === card);
}

/** Policy slots at a tier (§6.7: Village 2, Town 4, City 6, Metropolis 8). */
export function policySlots(tier: number): number {
  return POLICY_SLOTS[tier] ?? 0;
}

/** A card that costs money each month: the ones Helper Mode pauses (§5.13 step 4). */
export function isOptional(def: PolicyDef): boolean {
  return def.cost.kind === 'perResident' || def.cost.kind === 'flat';
}

/** Validates a painted area: [x, y, w, h, …] rectangles on the map. */
function checkArea(area: unknown, max: number): number[] {
  if (!Array.isArray(area) || area.length === 0 || area.length % 4 !== 0 || area.length / 4 > max) throw new EngineError(400, `Paint the area as 1 to ${max} rectangles.`);
  for (let i = 0; i < area.length; i += 4) {
    const [x, y, w, h] = area.slice(i, i + 4) as number[];
    if (![x, y, w, h].every((v) => Number.isInteger(v)) || w < 1 || h < 1 || x < 0 || y < 0 || x + w > MAP || y + h > MAP) throw new EngineError(400, 'That area is not on the map.');
  }
  return [...(area as number[])];
}

/** Sets or clears a painted card's bit over its area, keeping every other mark bit. */
function paint(t: TownState, area: readonly number[], bit: number, on: boolean): void {
  for (let i = 0; i < area.length; i += 4) {
    const [x0, y0, w, h] = [area[i], area[i + 1], area[i + 2], area[i + 3]];
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const tile = tileIndex(x, y);
        const v = pairGet(t.marks, tile);
        pairSet(t.marks, tile, on ? v | bit : v & ~bit);
      }
  }
}

function paintCard(t: TownState, a: ActivePolicy, on: boolean): void {
  const bit = PAINT_BIT[a.card];
  if (bit && a.area) paint(t, a.area, bit, on);
}

/** Helper Mode step 4: optional (money-costing) cards go to the memo until the budget recovers. */
export function pauseOptionalCards(t: TownState): void {
  const memo = civicMemo(t);
  const keep: ActivePolicy[] = [];
  for (const a of t.policies) {
    const def = policyDef(a.card);
    if (def && isOptional(def)) {
      paintCard(t, a, false);
      memo.paused.push(a);
    } else keep.push(a);
  }
  t.policies = keep;
}

/** Helper Mode has ended: paused cards come back (while slots allow), in the order they were paused. */
export function restorePausedCards(t: TownState): void {
  const memo = civicMemo(t);
  const slots = policySlots(t.tier);
  for (const a of memo.paused) {
    if (t.policies.length >= slots || t.policies.some((x) => x.card === a.card)) continue;
    t.policies.push(a);
    paintCard(t, a, true);
  }
  memo.paused = [];
}

/**
 * The `policy` move: enact (1 Initiative, a free slot, the card's tier) or
 * repeal (free; on the day it was enacted the Initiative comes back, §6.7).
 */
export function policyMove(c: CountyState, townIndex: number, cmd: Command): CommandResult {
  if (cmd.type !== 'policy') throw new EngineError(400, 'That move is not a policy card.');
  const t = c.towns[townIndex];
  const p = paramsFor(c.paramsVersion);
  const def = policyDef(cmd.card);
  if (!def) throw new EngineError(400, 'That is not a policy card.');
  const at = t.policies.findIndex((a) => a.card === def.id);
  if (!cmd.on) {
    if (at < 0) {
      const paused = civicMemo(t).paused.findIndex((a) => a.card === def.id);
      if (paused < 0) throw new EngineError(409, `${def.name} is not in force.`);
      civicMemo(t).paused.splice(paused, 1);
      return { ok: true, atTick: t.tick, cost: 0, data: { card: def.id, on: false } };
    }
    const a = t.policies[at];
    paintCard(t, a, false);
    t.policies.splice(at, 1);
    const sameDay = a.sinceDay === c.dayIndex;
    if (sameDay) t.initiatives += 1;
    return { ok: true, atTick: t.tick, cost: 0, data: { card: def.id, on: false, refunded: sameDay ? 1 : 0 } };
  }
  if (at >= 0) throw new EngineError(409, `${def.name} is already in force.`);
  if (t.tier < def.tier) throw new EngineError(409, `${def.name} unlocks at ${TIER_NAMES[def.tier][0].toUpperCase()}${TIER_NAMES[def.tier].slice(1)}.`);
  const slots = policySlots(t.tier);
  if (t.policies.length >= slots) throw new EngineError(409, slots === 0 ? 'Policy cards unlock at Village.' : `All ${slots} policy slots are full: repeal a card first.`);
  if (t.money.helper && isOptional(def)) throw new EngineError(409, 'Bramble has paused cards that cost money until the budget recovers.');
  if (t.initiatives < 1) throw new EngineError(409, 'Enacting a card takes a Mayor’s Initiative: a new one comes tomorrow.');
  let area: number[] | null = null;
  if (def.painted) area = checkArea(cmd.area, p.civic.policyRects);
  else if (cmd.area !== undefined && cmd.area !== null) throw new EngineError(400, `${def.name} covers the whole town: no area needed.`);
  const a: ActivePolicy = { card: def.id, sinceTick: t.tick, sinceDay: c.dayIndex, area };
  t.policies.push(a);
  paintCard(t, a, true);
  t.initiatives -= 1;
  return { ok: true, atTick: t.tick, cost: 0, data: { card: def.id, on: true } };
}
