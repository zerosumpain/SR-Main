// A phone at a party: one EventSource on `/api/games/party/<CODE>/stream`
// (`$lib/games/party.server` memberStream) with a reconnect and back-off, and
// the one way a move is sent (`playAct`). Copies `../screen/screen-stream.ts`.
//
// Handles are plain fields, never reactive state (svelte5-pitfalls §1); the
// component is told what to show through `onState`.
//
// An EventSource cannot read a status, so after repeated errors the stream
// URL is fetched once by hand: a 403 means this browser holds no seat here
// (`unseated`, the page shows its join form), a 404 that the party is gone
// (`closed`). Anything else is the network, and the back-off carries on.

/** The party as a player's stream sends it (`PartyView` in party.server, the fields a phone reads). */
export interface PlayParty {
  id: string;
  code: string;
  tvName: string;
  phase: 'lobby' | 'playing';
  locked: boolean;
  game: string | null;
  options: Record<string, unknown>;
  members: { id: string; name: string; kind: 'family' | 'guest'; online: boolean }[];
  /** The first in: their phone gets the TV's controls (`HostPanel`). */
  hostId: string | null;
  roomId: string | null;
  notice: string | null;
  games: { id: string; title: string; min: number; max: number }[];
  serverNow: number;
}

/** Every game's `toWire` carries at least these. */
export interface PlayRoom {
  id: string;
  game: string;
  phase: string;
  serverNow?: number;
  [key: string]: unknown;
}

export type PlayState =
  | { kind: 'connecting' }
  | { kind: 'party'; party: PlayParty }
  | { kind: 'room'; party: PlayParty; room: PlayRoom; skewMs: number }
  | { kind: 'kicked' }
  | { kind: 'closed' }
  | { kind: 'unseated'; message: string };

type Frame =
  | { type: 'party'; party: PlayParty }
  | { type: 'room'; room: PlayRoom }
  | { type: 'kicked' }
  | { type: 'closed' };

const streamUrl = (code: string) => `/api/games/party/${encodeURIComponent(code)}/stream`;

/** What the server says about a stream this browser cannot open: a state to end on, or null (the network). */
async function probe(code: string): Promise<PlayState | null> {
  const ctrl = new AbortController();
  try {
    const res = await fetch(streamUrl(code), { signal: ctrl.signal, headers: { accept: 'text/event-stream' } });
    if (res.ok) {
      ctrl.abort();
      return null;
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 404) return { kind: 'closed' };
    if (res.status === 401 || res.status === 403) return { kind: 'unseated', message: body?.error ?? 'Join the game on the TV first.' };
    return null;
  } catch {
    return null;
  }
}

/** Open this player's stream at the party behind `code`; returns the close. */
export function openPlay(code: string, onState: (s: PlayState) => void): () => void {
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let stopped = false;
  let party: PlayParty | null = null;
  let room: PlayRoom | null = null;

  const stop = () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    retry = null;
    source?.close();
    source = null;
  };

  const end = (s: PlayState) => {
    stop();
    onState(s);
  };

  const connect = () => {
    if (stopped) return;
    if (!party) onState({ kind: 'connecting' });
    source = new EventSource(streamUrl(code));
    source.onmessage = (event) => {
      attempts = 0;
      let frame: Frame;
      try {
        frame = JSON.parse(event.data) as Frame;
      } catch {
        return;
      }
      if (frame.type === 'kicked') end({ kind: 'kicked' });
      else if (frame.type === 'closed') end({ kind: 'closed' });
      else if (frame.type === 'party') {
        party = frame.party;
        // The room we hold is the party's still: keep showing it (a finish stays up until the room ends).
        if (room && party.roomId === room.id) {
          const serverNow = typeof room.serverNow === 'number' ? room.serverNow : Date.now();
          onState({ kind: 'room', party, room, skewMs: serverNow - Date.now() });
        } else {
          room = null;
          onState({ kind: 'party', party });
        }
      } else if (frame.type === 'room' && party) {
        room = frame.room;
        const serverNow = typeof room.serverNow === 'number' ? room.serverNow : Date.now();
        onState({ kind: 'room', party, room, skewMs: serverNow - Date.now() });
      }
    };
    source.onerror = () => {
      source?.close();
      source = null;
      if (stopped) return;
      attempts += 1;
      const delay = Math.min(10_000, 1_000 * 2 ** (attempts - 1));
      if (attempts >= 2) {
        void probe(code).then((s) => {
          if (stopped) return;
          if (s) end(s);
          else retry = setTimeout(connect, delay);
        });
      } else {
        retry = setTimeout(connect, delay);
      }
    };
  };

  connect();
  return stop;
}

/** A move in the game the TV is playing. Resolves to the player's room; throws the server's sentence. */
export async function playAct<R = PlayRoom>(code: string, body: Record<string, unknown>): Promise<R> {
  let res: Response;
  try {
    res = await fetch(`/api/games/party/${encodeURIComponent(code)}/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('No connection. Try again.');
  }
  const out = (await res.json().catch(() => null)) as { room?: R; error?: string } | null;
  if (!res.ok || !out?.room) throw new Error(out?.error ?? 'That did not go through. Try again.');
  return out.room;
}

/** One of the TV's verbs from the host's phone (`hostAct`); the party comes back on the stream too. */
export async function hostAct(code: string, body: Record<string, unknown>): Promise<PlayParty> {
  let res: Response;
  try {
    res = await fetch(`/api/games/party/${encodeURIComponent(code)}/host`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('No connection. Try again.');
  }
  const out = (await res.json().catch(() => null)) as { party?: PlayParty; error?: string } | null;
  if (!res.ok || !out?.party) throw new Error(out?.error ?? 'That did not go through. Try again.');
  return out.party;
}

/** Kelly's Quiz Night's approved packs, for the host's game list. Empty when there are none or the call fails. */
export async function hostPacks(code: string): Promise<{ id: string; title: string }[]> {
  try {
    const res = await fetch(`/api/games/party/${encodeURIComponent(code)}/host`);
    const out = (await res.json().catch(() => null)) as { packs?: { id: string; title: string }[] } | null;
    return res.ok && Array.isArray(out?.packs) ? out.packs : [];
  } catch {
    return [];
  }
}
