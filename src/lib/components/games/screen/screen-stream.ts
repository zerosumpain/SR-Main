// A TV board's connection: one EventSource on `/api/games/screens/stream`
// (`$lib/games/screens.server`), the ticket kept in this browser so a reload
// or a deploy picks the same room back up, and a reconnect with back-off.
//
// Handles are plain fields, never reactive state (svelte5-pitfalls §1); the
// component is told what to show through `onState`.

export type ScreenState<R = unknown> =
  | { kind: 'connecting' }
  | { kind: 'code'; code: string; expiresAt: number }
  | { kind: 'room'; room: R; skewMs: number };

type Frame =
  | { type: 'code'; code: string; expiresAt: number }
  | { type: 'paired'; ticket: string; expiresAt: number; roomId: string }
  | { type: 'room'; room: { serverNow?: number } }
  | { type: 'ended' };

const storageKey = (game: string) => `sr.games.screen.${game}`;

function readTicket(game: string): string | null {
  try {
    const raw = localStorage.getItem(storageKey(game));
    if (!raw) return null;
    const { ticket, expiresAt } = JSON.parse(raw) as { ticket?: string; expiresAt?: number };
    return ticket && typeof expiresAt === 'number' && expiresAt > Date.now() ? ticket : null;
  } catch {
    return null;
  }
}

function writeTicket(game: string, value: { ticket: string; expiresAt: number } | null): void {
  try {
    if (value) localStorage.setItem(storageKey(game), JSON.stringify(value));
    else localStorage.removeItem(storageKey(game));
  } catch {
    /* private window: the board still works, it just forgets on reload */
  }
}

/** Open the screen's stream; returns the close. `forget` drops the ticket first (a fresh code). */
export function openScreen<R>(game: string, onState: (s: ScreenState<R>) => void, opts: { forget?: boolean } = {}): () => void {
  if (opts.forget) writeTicket(game, null);
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let stopped = false;

  const connect = () => {
    if (stopped) return;
    const ticket = readTicket(game);
    const url = `/api/games/screens/stream?game=${encodeURIComponent(game)}${ticket ? `&ticket=${encodeURIComponent(ticket)}` : ''}`;
    if (!ticket) onState({ kind: 'connecting' });
    source = new EventSource(url);
    source.onmessage = (event) => {
      attempts = 0;
      let frame: Frame;
      try {
        frame = JSON.parse(event.data) as Frame;
      } catch {
        return;
      }
      if (frame.type === 'code') onState({ kind: 'code', code: frame.code, expiresAt: frame.expiresAt });
      else if (frame.type === 'paired') writeTicket(game, { ticket: frame.ticket, expiresAt: frame.expiresAt });
      else if (frame.type === 'ended') writeTicket(game, null);
      else if (frame.type === 'room') {
        const serverNow = typeof frame.room.serverNow === 'number' ? frame.room.serverNow : Date.now();
        onState({ kind: 'room', room: frame.room as R, skewMs: serverNow - Date.now() });
      }
    };
    source.onerror = () => {
      // Our own back-off, so the reconnect carries the latest ticket in its URL.
      source?.close();
      source = null;
      if (stopped) return;
      const delay = Math.min(10_000, 1_000 * 2 ** attempts++);
      retry = setTimeout(connect, delay);
    };
  };

  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    source?.close();
    source = null;
  };
}
