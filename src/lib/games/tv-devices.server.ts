// Linked TVs: the televisions allowed to host a party (`./party.server`).
//
// A TV has no login, so it is linked once by the owner: `/games/tv` opens a
// link stream and shows a code; the owner types it at /admin/games/tvs and
// names the TV; the stream hands the TV a token (`./party` issueTvToken),
// which the page posts to /api/games/tv/claim to be kept as the `sr_tv`
// cookie. A token is good only while its row in the `games-tvs` collection
// is there and not revoked — the HMAC proves it was issued, the row that it
// still may be used. Rows live in the datastore (the house pattern for
// feature state: no table, so no migration and no hand GRANT).

import { EventEmitter } from 'node:events';
import { env } from '$env/dynamic/private';
import { DatastoreError, ensureCollection, getRecordByKey, queryRecords, upsertRecord } from '$lib/datastore';
import { GameError } from './tap-duel';
import { issueTvToken, newTvId, verifyTvToken } from './party';
import { SCREEN_CODE_TTL_MS, newCode, normaliseCode } from './screens';

export const TVS_COLLECTION = 'games-tvs';
/** TVs waiting to be linked at once. The oldest makes way. */
export const MAX_LINK_WAITING = 50;
/** How long a token's row is trusted before it is read again (a revoke takes at most this long). */
const VERIFY_CACHE_MS = 60_000;
/** How often a TV's `lastSeenAt` is written while it is in use. */
const SEEN_EVERY_MS = 10 * 60_000;
const KEEPALIVE_MS = 15_000;
export const TV_NAME_MAX = 40;

export interface TvRow {
  id: string;
  name: string;
  linkedAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

export interface TvStore {
  list(): Promise<TvRow[]>;
  get(id: string): Promise<TvRow | null>;
  put(row: TvRow): Promise<void>;
}

const ACTOR = 'system';
const PERMS = { read: ['owner', 'system'], write: ['owner', 'system'], delete: ['owner', 'system'] };

function datastoreStore(): TvStore {
  let ensured = false;
  const ensure = async () => {
    if (ensured) return;
    await ensureCollection(
      TVS_COLLECTION,
      { name: 'Linked TVs', description: 'Televisions allowed to host a family games party (sr. tv)', isSystem: true, defaultPermissions: PERMS },
      ACTOR,
    );
    ensured = true;
  };
  return {
    async list() {
      await ensure();
      const { records } = await queryRecords(TVS_COLLECTION, { sort: { path: 'linkedAt', dir: 'desc' }, limit: 100 }, ACTOR);
      return records.map((r) => r.data as unknown as TvRow);
    },
    async get(id) {
      await ensure();
      try {
        return (await getRecordByKey(TVS_COLLECTION, id, ACTOR)).data as unknown as TvRow;
      } catch (err) {
        if (err instanceof DatastoreError && err.code === 'not_found') return null;
        throw err;
      }
    },
    async put(row) {
      await ensure();
      await upsertRecord(TVS_COLLECTION, { key: row.id, data: row as unknown as Record<string, unknown> }, ACTOR);
    },
  };
}

let store: TvStore | null = null;
const tvStore = () => (store ??= datastoreStore());

/** Tests only. */
export function _setTvStore(next: TvStore | null): void {
  store = next;
  verified.clear();
}

/** An in-memory store, for tests and the local TV harness. */
export function memoryTvStore(): TvStore {
  const rows = new Map<string, TvRow>();
  return {
    async list() {
      return [...rows.values()].sort((a, b) => b.linkedAt - a.linkedAt);
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async put(row) {
      rows.set(row.id, { ...row });
    },
  };
}

// ── Linking ─────────────────────────────────────────────────────────────────

interface Waiting {
  code: string;
  expiresAt: number;
  events: EventEmitter;
}

const waiting = new Map<string, Waiting>();

function openWaiting(now = Date.now()): Waiting {
  for (const [code, w] of waiting) if (w.expiresAt <= now) drop(code, 'expired');
  while (waiting.size >= MAX_LINK_WAITING) {
    const oldest = waiting.keys().next().value;
    if (oldest === undefined) break;
    drop(oldest, 'evicted');
  }
  const w: Waiting = { code: newCode((c) => waiting.has(c)), expiresAt: now + SCREEN_CODE_TTL_MS, events: new EventEmitter() };
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

/** A TV name as the list shows it: tidied, at most forty characters, never empty. */
export function cleanTvName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f<>]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, TV_NAME_MAX) : '';
  return name || 'TV';
}

/**
 * The owner typed `code` (the letters a TV is showing) and named the TV: it
 * is linked, and its waiting stream is handed its token. Refused with a
 * sentence for a code no TV is showing.
 */
export async function approveLink(rawCode: unknown, rawName: unknown, now = Date.now()): Promise<TvRow> {
  const code = normaliseCode(rawCode);
  if (!code) throw new GameError(400, 'Type the four letters the TV is showing.');
  const w = waiting.get(code);
  if (!w || w.expiresAt <= now) throw new GameError(404, 'No TV is showing that code. Check the letters on the screen.');
  const secret = env.AUTH_SECRET ?? '';
  const row: TvRow = { id: newTvId(), name: cleanTvName(rawName), linkedAt: now, lastSeenAt: now, revokedAt: null };
  const { token, expiresAt } = issueTvToken(row.id, secret, now);
  await tvStore().put(row);
  waiting.delete(code);
  w.events.emit('linked', { token, expiresAt, name: row.name });
  w.events.removeAllListeners();
  return row;
}

// ── Verifying ───────────────────────────────────────────────────────────────

const verified = new Map<string, { row: TvRow; at: number }>();

/** The linked TV a token (the `sr_tv` cookie) belongs to, or null: forged, expired, unknown or revoked. */
export async function tvFromToken(token: string | null | undefined, now = Date.now()): Promise<TvRow | null> {
  const id = verifyTvToken(token, env.AUTH_SECRET);
  if (!id) return null;
  const cached = verified.get(id);
  let row = cached && now - cached.at < VERIFY_CACHE_MS ? cached.row : null;
  if (!row) {
    row = await tvStore().get(id);
    if (!row) {
      verified.delete(id);
      return null;
    }
    verified.set(id, { row, at: now });
  }
  if (row.revokedAt) return null;
  if (!row.lastSeenAt || now - row.lastSeenAt > SEEN_EVERY_MS) {
    row = { ...row, lastSeenAt: now };
    verified.set(id, { row, at: now });
    void tvStore()
      .put(row)
      .catch((err) => console.error('[games] could not note a TV seen', (err as Error)?.message ?? err));
  }
  return row;
}

export async function listTvs(): Promise<TvRow[]> {
  return tvStore().list();
}

async function change(id: string, edit: (row: TvRow) => TvRow): Promise<TvRow> {
  const row = await tvStore().get(id);
  if (!row) throw new GameError(404, 'That TV is not linked.');
  const next = edit(row);
  await tvStore().put(next);
  verified.delete(id);
  return next;
}

/** Unlink a TV: its token stops working within a minute (at once on this process). */
export function revokeTv(id: string, now = Date.now()): Promise<TvRow> {
  return change(id, (row) => ({ ...row, revokedAt: row.revokedAt ?? now }));
}

export function renameTv(id: string, name: unknown): Promise<TvRow> {
  return change(id, (row) => ({ ...row, name: cleanTvName(name) }));
}

// ── The link stream ─────────────────────────────────────────────────────────

type Frame = { type: 'code'; code: string; expiresAt: number } | { type: 'linked'; token: string; expiresAt: number; name: string };

/**
 * A TV waiting to be linked: `code` frames (a fresh one every twenty
 * minutes) until the owner approves one, then one `linked` frame with the
 * token and the end of the stream. Public: a waiting TV learns only its own
 * code, and the registry is capped.
 */
export function linkStream(): Response {
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
  const end = () => {
    cleanup();
    try {
      controllerRef?.close();
    } catch {
      /* already closed */
    }
  };

  const wait = () => {
    if (closed) return;
    const w = openWaiting();
    send({ type: 'code', code: w.code, expiresAt: w.expiresAt });
    const timer = setTimeout(() => drop(w.code, 'expired'), Math.max(0, w.expiresAt - Date.now()));
    timer.unref?.();
    w.events.once('expired', () => {
      clearTimeout(timer);
      wait();
    });
    w.events.once('evicted', () => {
      clearTimeout(timer);
      end();
    });
    w.events.once('linked', (linked: { token: string; expiresAt: number; name: string }) => {
      clearTimeout(timer);
      stopCurrent = () => {};
      send({ type: 'linked', ...linked });
      end();
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

  wait();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      for (const chunk of pending.splice(0)) controller.enqueue(chunk);
      if (closed) controller.close();
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
export function _resetTvLinks(): void {
  for (const code of [...waiting.keys()]) drop(code, 'closed');
  verified.clear();
}
