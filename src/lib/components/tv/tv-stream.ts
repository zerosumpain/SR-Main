// The TV's connection to its party: one EventSource on
// `/api/games/tv/party/stream` (`$lib/games/party.server` tvStream) with a
// reconnect and back-off, and the TV's verbs as POSTs. The link screen's
// stream is `openLink`. Handles are plain fields (svelte5-pitfalls §1).

import type { PartyView } from '$lib/games/party';

export type TvState =
  | { kind: 'connecting' }
  | { kind: 'unlinked' }
  | { kind: 'party'; party: PartyView; room: unknown | null; skewMs: number };

type Frame = { type: 'party'; party: PartyView } | { type: 'room'; room: { serverNow?: number } } | { type: 'closed' };

/** Follow the TV's party; returns the close. */
export function openTv(onState: (s: TvState) => void): () => void {
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let stopped = false;
  let party: PartyView | null = null;
  let room: unknown | null = null;
  let skewMs = 0;

  const emit = () => {
    if (party) onState({ kind: 'party', party, room: party.roomId ? room : null, skewMs });
  };

  const connect = () => {
    if (stopped) return;
    source = new EventSource('/api/games/tv/party/stream');
    source.onmessage = (event) => {
      attempts = 0;
      let frame: Frame;
      try {
        frame = JSON.parse(event.data) as Frame;
      } catch {
        return;
      }
      if (frame.type === 'party') {
        if (party?.roomId !== frame.party.roomId) room = null;
        party = frame.party;
        skewMs = frame.party.serverNow - Date.now();
        emit();
      } else if (frame.type === 'room') {
        room = frame.room;
        if (typeof frame.room.serverNow === 'number') skewMs = frame.room.serverNow - Date.now();
        emit();
      } else if (frame.type === 'closed') {
        party = null;
        room = null;
        onState({ kind: 'connecting' });
      }
    };
    source.onerror = () => {
      source?.close();
      source = null;
      if (stopped) return;
      // A stream refused outright (401: this TV was unlinked) never opens; ask why.
      void fetch('/api/games/tv/party', { cache: 'no-store' })
        .then((res) => {
          if (res.status === 401) {
            stopped = true;
            onState({ kind: 'unlinked' });
          }
        })
        .catch(() => {});
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

export interface PartyAnswer {
  party: PartyView;
  joinUrl: string;
  qr: string;
}

/** Read the party with its QR, or run one of the TV's verbs. Throws an Error carrying the server's sentence. */
export async function tvParty(body?: Record<string, unknown>): Promise<PartyAnswer> {
  const res = await fetch('/api/games/tv/party', {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const out = (await res.json().catch(() => ({}))) as Partial<PartyAnswer> & { error?: string };
  if (!res.ok) throw new Error(out.error ?? 'Something went wrong. Try again.');
  return out as PartyAnswer;
}

export type LinkState = { kind: 'connecting' } | { kind: 'code'; code: string } | { kind: 'linked'; name: string } | { kind: 'failed' };

/** Wait to be linked: shows codes until the owner approves one, then keeps the token as this TV's cookie. */
export function openLink(onState: (s: LinkState) => void): () => void {
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const connect = () => {
    if (stopped) return;
    source = new EventSource('/api/games/tv/link');
    source.onmessage = (event) => {
      let frame: { type: string; code?: string; token?: string; name?: string };
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (frame.type === 'code' && frame.code) onState({ kind: 'code', code: frame.code });
      if (frame.type === 'linked' && frame.token) {
        stopped = true;
        source?.close();
        void fetch('/api/games/tv/claim', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: frame.token }),
        })
          .then((res) => onState(res.ok ? { kind: 'linked', name: frame.name ?? 'TV' } : { kind: 'failed' }))
          .catch(() => onState({ kind: 'failed' }));
      }
    };
    source.onerror = () => {
      source?.close();
      source = null;
      if (!stopped) retry = setTimeout(connect, 3_000);
    };
  };

  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    source?.close();
  };
}
