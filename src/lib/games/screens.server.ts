// TV boards: the waiting screens, pairing, and the one stream a screen holds.
//
// In memory, like the rooms. A screen waiting for its code to be typed is a
// row in `waiting`; once a player pairs it, the screen is handed a ticket
// (`./screens`) and follows the room through `watch`. The ticket is what
// survives — a reload or a deploy — so nothing here needs to.
//
// The stream (`/api/games/screens/stream?game=<id>[&ticket=…]`) is PUBLIC: a
// TV has no login. What it can carry is bounded twice over: a waiting screen
// learns only its own code; a paired one only `toScreen`, which each game
// writes as the table everyone in the room can already see. The registry is
// capped, so anonymous streams cannot grow it without bound.

import { EventEmitter } from 'node:events';
import { env } from '$env/dynamic/private';
import { GameError } from './tap-duel';
import { GAMES, isGameId, type GameId } from './catalogue';
import { ensureRoom, screenGame, watch } from './rooms.server';
import { SCREEN_CODE_TTL_MS, issueScreenTicket, newCode, normaliseCode, verifyScreenTicket } from './screens';

/** Waiting screens at once, across every TV. The oldest makes way. */
export const MAX_WAITING = 200;
const KEEPALIVE_MS = 15_000;

interface Waiting {
  code: string;
  game: GameId;
  expiresAt: number;
  events: EventEmitter;
}

const waiting = new Map<string, Waiting>();

/** The games that have a TV board, for the phones to offer "Show on TV" in. */
export function screenGames(): GameId[] {
  return (Object.keys(GAMES) as GameId[]).filter((g) => !!GAMES[g].toScreen);
}

function openWaiting(game: GameId, now = Date.now()): Waiting {
  for (const [code, w] of waiting) if (w.expiresAt <= now) drop(code, 'expired');
  while (waiting.size >= MAX_WAITING) {
    const oldest = waiting.keys().next().value;
    if (oldest === undefined) break;
    drop(oldest, 'evicted');
  }
  const w: Waiting = { code: newCode((c) => waiting.has(c)), game, expiresAt: now + SCREEN_CODE_TTL_MS, events: new EventEmitter() };
  waiting.set(w.code, w);
  return w;
}

function drop(code: string, why: 'expired' | 'evicted' | 'closed'): void {
  const w = waiting.get(code);
  if (!w) return;
  waiting.delete(code);
  if (why !== 'closed') w.events.emit(why);
  w.events.removeAllListeners();
}

/**
 * A player in room `roomId` typed `code`: that waiting screen now shows the
 * room. The caller has checked they are in it. Refused (GameError) for a
 * code no screen is showing, or one showing a different game.
 */
export function pairScreen(rawCode: unknown, roomId: string, now = Date.now()): { code: string } {
  const code = normaliseCode(rawCode);
  if (!code) throw new GameError(400, 'Type the four letters the TV is showing.');
  const game = screenGame(roomId);
  const w = waiting.get(code);
  if (!w || w.expiresAt <= now) throw new GameError(404, 'No TV is showing that code. Check the letters on the screen.');
  if (w.game !== game) throw new GameError(409, `That TV is set up for a different game. Open /games/${game} on it.`);
  waiting.delete(code);
  w.events.emit('paired', roomId);
  w.events.removeAllListeners();
  return { code };
}

type Frame =
  | { type: 'code'; code: string; expiresAt: number; game: GameId }
  | { type: 'paired'; ticket: string; expiresAt: number; roomId: string }
  | { type: 'room'; room: unknown }
  | { type: 'ended' };

/**
 * One TV's stream. With a valid ticket it follows that room; without one, or
 * once the room has gone, it waits with a code and follows whatever room
 * pairs it. Frames: `code` (show these letters), `paired` (keep this ticket),
 * `room` (the table), `ended` (the room went; a `code` follows).
 */
export async function screenStream(gameParam: string | null, ticket: string | null): Promise<Response> {
  if (!isGameId(gameParam) || !GAMES[gameParam].toScreen) throw new GameError(404, 'There is no TV board for that game.');
  const game = gameParam;
  const secret = env.AUTH_SECRET ?? '';
  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const pending: Uint8Array[] = [];
  let closed = false;
  let stopCurrent = () => {};

  const write = (text: string) => {
    if (closed) return;
    const chunk = encoder.encode(text);
    if (!controllerRef) {
      pending.push(chunk);
      return;
    }
    try {
      controllerRef.enqueue(chunk);
    } catch {
      cleanup();
    }
  };
  const send = (frame: Frame) => write(`data: ${JSON.stringify(frame)}\n\n`);

  /** Follow a room; false when it is not there to follow (or not this game's). */
  const follow = async (roomId: string): Promise<boolean> => {
    try {
      await ensureRoom(roomId);
      if (screenGame(roomId) !== game) return false;
      stopCurrent = watch(
        roomId,
        (room) => send({ type: 'room', room }),
        () => {
          if (closed) return;
          send({ type: 'ended' });
          stopCurrent = () => {};
          wait();
        },
      );
      return true;
    } catch (err) {
      if (err instanceof GameError) return false;
      throw err;
    }
  };

  const wait = () => {
    if (closed) return;
    const w = openWaiting(game);
    send({ type: 'code', code: w.code, expiresAt: w.expiresAt, game });
    const timer = setTimeout(() => drop(w.code, 'expired'), Math.max(0, w.expiresAt - Date.now()));
    timer.unref?.();
    const again = () => {
      clearTimeout(timer);
      wait();
    };
    w.events.once('expired', again);
    // Evicted by newer screens: this one ends; the page reconnects for a fresh code.
    w.events.once('evicted', () => {
      clearTimeout(timer);
      cleanup();
      try {
        controllerRef?.close();
      } catch {
        /* already closed */
      }
    });
    w.events.once('paired', (roomId: string) => {
      clearTimeout(timer);
      let issued: { ticket: string; expiresAt: number };
      try {
        issued = issueScreenTicket(roomId, secret);
      } catch (err) {
        console.error('[games] could not issue a screen ticket', (err as Error)?.message ?? err);
        wait();
        return;
      }
      send({ type: 'paired', ticket: issued.ticket, expiresAt: issued.expiresAt, roomId });
      void follow(roomId).then((ok) => {
        if (!ok && !closed) wait();
      });
    });
    stopCurrent = () => {
      clearTimeout(timer);
      drop(w.code, 'closed');
    };
  };

  const keepalive = setInterval(() => write(': keepalive\n\n'), KEEPALIVE_MS);
  keepalive.unref?.();
  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    stopCurrent();
  }

  const roomId = verifyScreenTicket(ticket, secret);
  if (!(roomId && (await follow(roomId)))) {
    if (ticket) send({ type: 'ended' });
    wait();
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      for (const chunk of pending.splice(0)) controller.enqueue(chunk);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/** Tests only. */
export function _resetScreens(): void {
  for (const code of [...waiting.keys()]) drop(code, 'closed');
}

/** Tests only: the codes waiting now. */
export function _waitingCodes(): string[] {
  return [...waiting.keys()];
}
