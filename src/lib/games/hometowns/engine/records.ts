// Stored records (spec §5.1, §10.2): the history rings behind every chart and
// the tile-event log behind the time-lapse and the per-viewer deltas. Both
// are compact binary rings in base64 strings. The tile log is appended to
// many times a tick, so like the planes it is decoded once per town object
// and written back by commitRecords (the driver calls it with commitPlanes).

import { bytesToInt32, fromBase64, int32ToBytes, rleDecode, rleEncode, toBase64 } from './codec';
import type { TownState } from './types';

// ---- History: 14 series × (12 monthly + 42 daily) Int32 ---------------------------------

/** The charted series, in ring order. Values are stored ×scale as Int32. */
export const HISTORY_SERIES = [
  { id: 'pop', scale: 1 },
  { id: 'reserves', scale: 1 },
  { id: 'revenue', scale: 1 },
  { id: 'spending', scale: 1 },
  { id: 'mood', scale: 100 },
  { id: 'approval', scale: 100 },
  { id: 'jobs', scale: 1 },
  { id: 'unemployed', scale: 1 },
  { id: 'visitors', scale: 1 },
  { id: 'goodsNet', scale: 10 },
  { id: 'meterHomes', scale: 100 },
  { id: 'meterShops', scale: 100 },
  { id: 'meterIndustry', scale: 100 },
  { id: 'safety', scale: 100 },
] as const;
export type HistorySeries = (typeof HISTORY_SERIES)[number]['id'];
export const HISTORY_MONTHS = 12;
export const HISTORY_DAYS = 42;
const SERIES = HISTORY_SERIES.length;
// Header: monthly head, monthly count, daily head, daily count.
const HEAD = 4;
const SIZE = HEAD + SERIES * (HISTORY_MONTHS + HISTORY_DAYS);

function loadHistory(t: TownState): Int32Array {
  if (!t.history) return new Int32Array(SIZE);
  return bytesToInt32(rleDecode(fromBase64(t.history), SIZE * 4));
}

function scaled(v: number, scale: number): number {
  const r = Math.round(v * scale);
  return r > 2147483647 ? 2147483647 : r < -2147483648 ? -2147483648 : r;
}

function push(t: TownState, values: Partial<Record<HistorySeries, number>>, daily: boolean): void {
  const a = loadHistory(t);
  const len = daily ? HISTORY_DAYS : HISTORY_MONTHS;
  const hi = daily ? 2 : 0;
  const base = HEAD + (daily ? SERIES * HISTORY_MONTHS : 0);
  const slot = a[hi];
  for (let s = 0; s < SERIES; s++) a[base + s * len + slot] = scaled(values[HISTORY_SERIES[s].id] ?? 0, HISTORY_SERIES[s].scale);
  a[hi] = (slot + 1) % len;
  a[hi + 1] = Math.min(len, a[hi + 1] + 1);
  t.history = toBase64(rleEncode(int32ToBytes(a)));
}

/** Month end sample (WP2d's M14 calls it; the stub records pop and reserves). */
export function pushHistoryMonth(t: TownState, values: Partial<Record<HistorySeries, number>>): void {
  push(t, values, false);
}

/** Regional Day sample (§8.3 step 7). */
export function pushHistoryDay(t: TownState, values: Partial<Record<HistorySeries, number>>): void {
  push(t, values, true);
}

/** One series, oldest first. */
export function readHistory(t: TownState, series: HistorySeries, daily = false): number[] {
  const a = loadHistory(t);
  const s = HISTORY_SERIES.findIndex((x) => x.id === series);
  const len = daily ? HISTORY_DAYS : HISTORY_MONTHS;
  const head = a[daily ? 2 : 0];
  const count = a[daily ? 3 : 1];
  const base = HEAD + (daily ? SERIES * HISTORY_MONTHS : 0) + s * len;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(a[base + ((head - count + i + len) % len)] / HISTORY_SERIES[s].scale);
  return out;
}

// ---- Tile log: ring of 600 events, 6 bytes each -----------------------------------------------
//
// [tick u24][tile 12 bits | kind 4 bits][value u8]; header [head u16][count u16]; stored RLE'd.

export const TILE_LOG_SIZE = 600;
export const TILE_EVENTS = [
  'built', 'started', 'levelUp', 'declined', 'incident', 'repaired', 'zoned', 'dezoned',
  'road', 'bulldozed', 'placed', 'parcel', 'retier', 'other4', 'other5', 'other6',
] as const;
export type TileEventKind = (typeof TILE_EVENTS)[number];
export interface TileEvent {
  tick: number;
  tile: number;
  kind: TileEventKind;
  value: number;
}

interface LogEntry {
  src: string;
  bytes: Uint8Array;
  dirty: boolean;
}
const LOG_CACHE = new WeakMap<TownState, LogEntry>();
const LOG_BYTES = 4 + TILE_LOG_SIZE * 6;

function logOf(t: TownState): LogEntry {
  let e = LOG_CACHE.get(t);
  if (!e || (!e.dirty && e.src !== t.tileLog)) {
    const bytes = t.tileLog ? rleDecode(fromBase64(t.tileLog), LOG_BYTES) : new Uint8Array(LOG_BYTES);
    e = { src: t.tileLog, bytes, dirty: false };
    LOG_CACHE.set(t, e);
  }
  return e;
}

export function appendTileEvent(t: TownState, tick: number, tile: number, kind: TileEventKind, value = 0): void {
  const e = logOf(t);
  const b = e.bytes;
  const head = b[0] | (b[1] << 8);
  const count = b[2] | (b[3] << 8);
  const o = 4 + head * 6;
  const k = TILE_EVENTS.indexOf(kind);
  b[o] = tick & 255;
  b[o + 1] = (tick >>> 8) & 255;
  b[o + 2] = (tick >>> 16) & 255;
  const tk = ((tile & 0xfff) << 4) | (k & 15);
  b[o + 3] = tk & 255;
  b[o + 4] = tk >>> 8;
  b[o + 5] = value & 255;
  const nh = (head + 1) % TILE_LOG_SIZE;
  b[0] = nh & 255;
  b[1] = nh >>> 8;
  const nc = Math.min(TILE_LOG_SIZE, count + 1);
  b[2] = nc & 255;
  b[3] = nc >>> 8;
  e.dirty = true;
}

/** Events oldest first, optionally only those at or after `sinceTick`. */
export function readTileLog(t: TownState, sinceTick = 0): TileEvent[] {
  const b = logOf(t).bytes;
  const head = b[0] | (b[1] << 8);
  const count = b[2] | (b[3] << 8);
  const out: TileEvent[] = [];
  for (let i = 0; i < count; i++) {
    const o = 4 + ((head - count + i + TILE_LOG_SIZE) % TILE_LOG_SIZE) * 6;
    const tick = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
    if (tick < sinceTick) continue;
    const tk = b[o + 3] | (b[o + 4] << 8);
    out.push({ tick, tile: tk >>> 4, kind: TILE_EVENTS[tk & 15], value: b[o + 5] });
  }
  return out;
}

export function commitRecords(t: TownState): void {
  const e = LOG_CACHE.get(t);
  if (!e || !e.dirty) return;
  e.dirty = false;
  e.src = toBase64(rleEncode(e.bytes));
  t.tileLog = e.src;
}

export function forgetRecords(t: TownState): void {
  LOG_CACHE.delete(t);
}
