// Every move goes through applyCommand (spec §10.6), which the server, the
// page and the bots all use. The county-level rules live here:
//   - A28 idempotency: a repeated planId/moveId from the same seat returns the
//     earlier result from the 150-entry log instead of applying twice;
//   - A19 exact ticks: the acting town is caught up to now (never past an unrun
//     Regional Day) before the move is validated, and while a Regional Day is
//     due the move is refused with a retry flag;
//   - the per-player rate limit, the log, and per-move permissions.
// Town-level moves are applied by ops.ts. Moves owned by other packages are
// routed through HANDLERS; until a package lands, its moves are refused
// politely ("not ready yet"), never silently accepted.

import { effectiveNow, gridTickAt, hello as clockHello, nextRegionalDayAt, setPause } from './clock';
import { catchUpTown, sprintTick } from './tick';
import { foundTown, townIndexOf } from './county';
import { commitTown } from './core';
import { applyBudget, applyBuild, applyUndo, type OpsEnv } from './ops';
import { bondMove, loanMove } from './finance';
import { ordersMove } from './orders';
import { policyMove } from './policies';
import { paramsFor } from './params';
import {
  EngineError,
  type Actor,
  type Command,
  type CommandRecord,
  type CommandResult,
  type CountyState,
  type MoveType,
  type SeatId,
} from './types';

export const LOG_KEEP = 150;

/** A move handler for moves owned by a package (WP2d, WP3): validate, apply, return the result. */
export type MoveHandler = (c: CountyState, townIndex: number, cmd: Command, actor: Actor, now: number) => CommandResult;

const notYet: MoveHandler = () => {
  throw new EngineError(400, 'That isn’t ready yet in this version of Hometowns.');
};

/**
 * Package-owned moves. Repoint a row to your handler when your package lands
 * (WP2d: policy, orders, loan, bond; WP3: the county moves).
 */
export const HANDLERS: Partial<Record<MoveType, MoveHandler>> = {
  policy: policyMove, // WP2d policies.ts
  orders: ordersMove, // WP2d orders.ts
  loan: loanMove, // WP2d finance.ts
  bond: bondMove, // WP2d finance.ts
  deal: notYet, // WP3
  link: notYet, // WP3 region.ts
  contract: notYet, // WP3
  share: notYet, // WP3
  pact: notYet, // WP3
  pledge: notYet, // WP3 greatworks.ts
  vote: notYet, // WP3 council.ts
  bid: notYet, // WP3
  advert: notYet, // WP3
  gift: notYet, // WP3
  aid: notYet, // WP3
  prank: notYet, // WP3
  prankReply: notYet, // WP3
  stamp: notYet, // WP3
  attend: notYet, // WP3
  holiday: notYet, // WP3
  settings: notYet, // WP4 (adapter-level permissions) / WP3
};

/** The client id of a move: planId for build, moveId for the rest ('' when it has none). */
export function moveId(cmd: Command): string {
  if (cmd.type === 'build') return typeof cmd.planId === 'string' ? cmd.planId : '';
  const id = (cmd as { moveId?: unknown }).moveId;
  return typeof id === 'string' ? id : '';
}

function record(c: CountyState, r: CommandRecord): void {
  c.log.push(r);
  while (c.log.length > LOG_KEEP) c.log.shift();
}

/** Moves that need no town of the actor's own. */
const COUNTY_MOVES = new Set<MoveType>(['found', 'hello', 'pause', 'visit', 'settings']);
/** Presence-only moves: never refused for a due Regional Day, never logged (they would fill the log). */
const QUIET_MOVES = new Set<MoveType>(['hello', 'seen', 'visit']);

/**
 * §10.3 applyCommand: validate, apply, record. Throws EngineError(400 | 403 |
 * 404 | 409, sentence) for a refused move; a 409 with `retry` means "a
 * Regional Day is finishing: try again in a second".
 */
export function applyCommand(c: CountyState, who: SeatId | Actor, cmd: Command, now: number): CommandResult {
  const actor: Actor = typeof who === 'string' ? { seat: who } : who;
  const seat = actor.seat;
  if (!Number.isFinite(now)) throw new EngineError(400, 'The clock is not ready yet.');
  if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') throw new EngineError(400, 'That move is not one this game knows.');
  const p = paramsFor(c.paramsVersion);

  // A28: a repeated id returns the earlier result.
  const id = moveId(cmd);
  if (id) {
    for (let i = c.log.length - 1; i >= 0; i--) {
      const r = c.log[i];
      if (r.seat === seat && r.id === id && r.type === cmd.type) return { ...r.result, replayed: true };
    }
  }
  if (cmd.type === 'build' && !id) throw new EngineError(400, 'A plan needs its planId.');

  // The rate limit: 60 moves a minute per player.
  let recent = 0;
  for (let i = c.log.length - 1; i >= 0 && c.log[i].at > now - 60_000; i--) if (c.log[i].seat === seat) recent++;
  if (recent >= p.build.movesPerMinute) throw new EngineError(409, 'Slow down a little: try again in a minute.');

  if (cmd.type === 'hello' || cmd.type === 'found') clockHello(c, now);

  const R = nextRegionalDayAt(c, p.clock.devRegionalTicks);
  const eff = effectiveNow(c, now, p.clock.napAfterMs);
  if (R <= eff && !QUIET_MOVES.has(cmd.type)) throw new EngineError(409, 'Kingsport is just finishing the day. Trying again…', true);

  let townIndex = townIndexOf(c, seat);
  if (cmd.type !== 'found' && !COUNTY_MOVES.has(cmd.type)) {
    if (townIndex < 0) throw new EngineError(404, 'You have no town yet: found one first.');
    if (c.towns[townIndex].archived) throw new EngineError(409, 'This town is resting now.');
  }
  // A19: catch the acting town up to now (bounded by the Regional Day) before validating.
  if (townIndex >= 0) catchUpTown(c, townIndex, gridTickAt(c, Math.min(eff, R)));

  const profile = actor.profile ?? c.settings.perSeat[seat]?.profile ?? 'adult';
  const env: OpsEnv = { params: p, dayIndex: c.dayIndex, profile };
  let result: CommandResult;
  const t = townIndex >= 0 ? c.towns[townIndex] : null;
  switch (cmd.type) {
    case 'found': {
      foundTown(c, seat, cmd, now);
      townIndex = townIndexOf(c, seat);
      result = { ok: true, atTick: 0, cost: 0, data: { town: townIndex } };
      break;
    }
    case 'hello': {
      if (t) t.away.lastHelloAt = now;
      result = { ok: true, atTick: t ? t.tick : -1, cost: 0 };
      break;
    }
    case 'seen': {
      if (!t) throw new EngineError(404, 'You have no town yet.');
      const tick = Math.floor(Number(cmd.tick));
      t.lastSeenTick = Math.max(0, Math.min(t.tick, Number.isFinite(tick) ? tick : 0));
      result = { ok: true, atTick: t.tick, cost: 0 };
      break;
    }
    case 'visit':
      result = { ok: true, atTick: -1, cost: 0 };
      break;
    case 'sprint': {
      const town = t!;
      if (town.gridBase !== null || town.sprintLeft <= 0) throw new EngineError(409, 'The Founding Fortnight is over: your town runs on the county clock now.');
      if (cmd.auto) {
        town.sprintAuto = true;
        if (town.sprintAt === 0) town.sprintAt = now;
        result = { ok: true, atTick: town.tick, cost: 0, data: { auto: true } };
        break;
      }
      if (town.sprintAt !== 0 && now - town.sprintAt < p.clock.sprintMinGapMs) throw new EngineError(409, 'Watch your town grow for a few seconds first.');
      const at = town.tick;
      sprintTick(c, townIndex, now);
      result = { ok: true, atTick: at, cost: 0, data: { left: town.sprintLeft } };
      break;
    }
    case 'build':
      result = applyBuild(t!, cmd.planId, cmd.plan, env);
      break;
    case 'undo':
      result = applyUndo(t!, cmd.planId, env);
      break;
    case 'budget':
      result = applyBudget(t!, cmd.taxes, cmd.funding, env);
      break;
    case 'pause': {
      if (!actor.isParent && !c.parents.includes(seat)) throw new EngineError(403, 'Only a parent can pause the county.');
      setPause(c, !!cmd.on, now);
      result = { ok: true, atTick: -1, cost: 0 };
      break;
    }
    default: {
      const h = HANDLERS[cmd.type];
      if (!h) throw new EngineError(400, 'That move is not one this game knows.');
      result = h(c, townIndex, cmd, actor, now);
    }
  }
  if (t) commitTown(t);
  if (!QUIET_MOVES.has(cmd.type)) record(c, { id, seat, type: cmd.type, at: now, atTick: result.atTick, cmd, result });
  return result;
}
