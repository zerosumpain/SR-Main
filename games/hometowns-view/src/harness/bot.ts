// The harness's mayor: the Lab's own Balanced bot (engine/bots, spec §11.1:
// "bots live in engine/bots/ and are shared"), playing through the real move
// API (applyCommand) exactly as a phone would, so harness mode has a living
// town to draw without a server (§9.16).
//
// The bot reads the same view the Lab's bots read (viewOf), takes Bramble's
// three steps at founding, and then plays the Balanced bot's session three
// times a game day, as the Lab's Balanced mayor does. Nothing here knows how
// to plan a town: when the bots get better, harness mode gets better with
// them, and the two can never drift apart.
//
// Everything it does is a pure function of the county state and `now` (no
// Math.random, no clock), so a seed replays the same town every time.

import { BOTS, EngineError, applyCommand, brambleCommands, viewOf, type Command, type CountyState } from '../engine';

/** The Lab's yardstick mayor. */
const BOT = BOTS.balanced;
/** Months between sessions: three a Regional Day (48 ticks = 12 months), the Lab's daily rhythm. */
export const SESSION_MONTHS = 4;

export interface BotTurn {
  /** Types of the moves that were applied. */
  moves: string[];
  /** Refusal sentences (EngineError), for the harness log. */
  refused: string[];
  /** A Regional Day was finishing: the harness should run catch-up and try again. */
  retry: boolean;
}

/** The bot's choices for one session: a counter-based stream keyed by the county seed and the instant. */
export function sessionRng(seed: number, now: number): () => number {
  let a = (Math.imul(seed >>> 0, 2654435761) ^ Math.floor(now / 1000)) >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

/**
 * One bot turn for `seat` at `now`. The harness calls it once a game month
 * (and once at founding); the bot plays at founding and then every
 * SESSION_MONTHS months. Refusals are collected, never thrown.
 */
export function botTurn(c: CountyState, seat: string, now: number): BotTurn {
  const turn: BotTurn = { moves: [], refused: [], retry: false };
  const t = c.towns.find((q) => q.seat === seat);
  if (!t || t.archived) return turn;
  const act = (cmd: Command, at: number) => {
    try {
      applyCommand(c, seat, cmd, at);
      turn.moves.push(cmd.type);
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      if (e.retry) turn.retry = true;
      turn.refused.push(e.message);
    }
  };
  act({ type: 'hello' }, now);
  const founding = t.tick === 0 && t.undo.length === 0;
  if (!founding && Math.floor(t.tick / 4) % SESSION_MONTHS !== 0) return turn;
  const view = viewOf(c, seat, now);
  if (!view) return turn;
  const cmds = founding ? brambleCommands(view) : BOT.policy(view, sessionRng(c.seed, now)).slice(0, BOT.sessions.actions);
  cmds.forEach((cmd, k) => act(cmd, now + 1 + k));
  return turn;
}
