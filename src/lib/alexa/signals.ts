// Turning Home Assistant history for the Echos' other entities into change
// rows. Pure — no HA, no DB.
//
// The entity list comes from HA itself (`integration_entities('alexa_devices')`),
// so the suffixes below only have to tell the kinds apart, not pick Alexa
// entities out of the whole house.

import type { HAHistoryState, ParsedSignal, SignalKind } from './types';

const KIND_BY_SUFFIX: [RegExp, SignalKind][] = [
  [/^sensor\..+_temperature$/, 'temperature'],
  [/^sensor\..+_illuminance$/, 'illuminance'],
  [/^binary_sensor\..+_motion$/, 'motion'],
  [/^sensor\..+_next_alarm$/, 'alarm'],
  [/^sensor\..+_next_timer$/, 'timer'],
  [/^sensor\..+_next_reminder$/, 'reminder'],
  [/^media_player\./, 'media'],
];

export function signalKind(entityId: string): SignalKind | null {
  for (const [re, kind] of KIND_BY_SUFFIX) if (re.test(entityId)) return kind;
  return null;
}

/** "John's Echo Temperature" → "John's Echo"; "SoundBar Next alarm" → "SoundBar". */
export function signalDevice(entityId: string, friendlyName: unknown): string {
  const strip = /\s+(temperature|illuminance|motion|next (alarm|timer|reminder))$/i;
  if (typeof friendlyName === 'string' && friendlyName.trim()) return friendlyName.replace(strip, '').trim();
  return entityId
    .replace(/^[a-z_]+\./, '')
    .replace(/_(temperature|illuminance|motion|next_alarm|next_timer|next_reminder)$/, '')
    .replace(/_/g, ' ');
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

/** What a state says, or `undefined` when it says nothing worth a row. */
type Reading = Pick<ParsedSignal, 'value' | 'text' | 'detail'>;

function read(kind: SignalKind, s: HAHistoryState): Reading | undefined {
  const a = s.attributes ?? {};
  switch (kind) {
    case 'temperature': {
      const n = Number(s.state);
      if (s.state === '' || !Number.isFinite(n)) return undefined;
      // The integration reports in the Echo's own scale; the site speaks Celsius.
      const c = /°?F$/i.test(String(a.unit_of_measurement ?? '')) ? ((n - 32) * 5) / 9 : n;
      return { value: Math.round(c * 10) / 10, text: null, detail: null };
    }
    case 'illuminance': {
      const n = Number(s.state);
      if (s.state === '' || !Number.isFinite(n)) return undefined;
      return { value: n, text: null, detail: null };
    }
    case 'motion':
      return s.state === 'on' || s.state === 'off' ? { value: null, text: s.state, detail: null } : undefined;
    case 'alarm':
    case 'timer':
    case 'reminder': {
      // Only a due time is a row. The sensor reads `unavailable` both when
      // nothing is pending AND when the Echo drops off the network — which
      // every Echo does in the router's nightly 03:00 blip, so a "cleared"
      // here would mostly be a lie followed by the same alarm "set" again.
      const at = Date.parse(s.state);
      return Number.isFinite(at) ? { value: null, text: new Date(at).toISOString(), detail: null } : undefined;
    }
    case 'media': {
      // A row is a track STARTING. Idle and paused keep the last title on the
      // entity for hours, which is not listening.
      if (s.state !== 'playing') return undefined;
      const title = str(a.media_title);
      if (!title) return undefined;
      const detail: Record<string, unknown> = {};
      for (const [k, key] of [
        ['artist', 'media_artist'],
        ['album', 'media_album_name'],
        ['contentType', 'media_content_type'],
        ['app', 'app_name'],
        ['duration', 'media_duration'],
      ] as const) {
        if (a[key] != null && a[key] !== '') detail[k] = a[key];
      }
      return { value: null, text: title, detail };
    }
  }
}

/** One history state → one candidate row, or null. */
export function parseSignalState(s: HAHistoryState, rooms: Record<string, string | null> = {}): ParsedSignal | null {
  const kind = signalKind(s.entity_id);
  if (!kind) return null;
  // `last_updated` moves on an attribute-only change (the next track while
  // already playing); `last_changed` only on the state itself.
  const stamp = kind === 'media' ? (s.last_updated ?? s.last_changed) : (s.last_changed ?? s.last_updated);
  const at = stamp ? Date.parse(stamp) : NaN;
  if (!Number.isFinite(at)) return null;
  const r = read(kind, s);
  if (r === undefined) return null;
  const occurredAt = new Date(at);
  return {
    id: `${s.entity_id}|${occurredAt.toISOString()}`,
    entityId: s.entity_id,
    kind,
    device: signalDevice(s.entity_id, s.attributes?.friendly_name),
    room: rooms[s.entity_id] ?? null,
    occurredAt,
    ...r,
  };
}

/** A whole `/api/history/period` response → candidate rows, oldest first. */
export function parseSignalHistory(series: unknown, rooms: Record<string, string | null> = {}): ParsedSignal[] {
  if (!Array.isArray(series)) return [];
  const out: ParsedSignal[] = [];
  for (const list of series) {
    if (!Array.isArray(list)) continue;
    let entityId = '';
    for (const raw of list as HAHistoryState[]) {
      if (raw?.entity_id) entityId = raw.entity_id;
      const row = parseSignalState({ ...raw, entity_id: raw?.entity_id || entityId }, rooms);
      if (row) out.push(row);
    }
  }
  return out.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

/** The newest stored row per entity, as far as change detection needs it. */
export interface LastSignal {
  text: string | null;
  value: number | null;
  artist?: unknown;
}

function same(a: LastSignal, b: LastSignal): boolean {
  return a.text === b.text && a.value === b.value && (a.artist ?? null) === (b.artist ?? null);
}

/**
 * Keep only CHANGES. HA's history re-emits a value on every attribute churn
 * and opens each window with the value already current, and a sensor that
 * blinks `unavailable` comes back with the same reading — none of those are
 * news. An alarm/timer/reminder row is a NEW due time; the same one seen
 * again after the nightly network blip is the same one.
 */
export function newSignals(rows: readonly ParsedSignal[], last: Record<string, LastSignal | undefined>): ParsedSignal[] {
  const prev: Record<string, LastSignal | undefined> = { ...last };
  const seen = new Set<string>();
  const out: ParsedSignal[] = [];
  for (const r of [...rows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const cur: LastSignal = { text: r.text, value: r.value, artist: r.detail?.artist };
    const p = prev[r.entityId];
    if (p && same(p, cur)) continue;
    out.push(r);
    prev[r.entityId] = cur;
  }
  return out;
}
