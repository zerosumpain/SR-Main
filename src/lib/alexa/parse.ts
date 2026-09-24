// Turning Home Assistant history into utterance rows. Pure — no HA, no DB.

import type { HAHistoryState, ParsedUtterance } from './types';

/** The suffix HA gives every one of these entities. */
export const VOICE_EVENT_SUFFIX = '_voice_event';

export function isVoiceEventEntity(entityId: string): boolean {
  return entityId.startsWith('event.') && entityId.endsWith(VOICE_EVENT_SUFFIX);
}

/** "John's Echo Studio Voice event" → "John's Echo Studio". */
export function deviceName(entityId: string, friendlyName: unknown): string {
  if (typeof friendlyName === 'string' && friendlyName.trim()) {
    return friendlyName.replace(/\s+voice event$/i, '').trim();
  }
  return entityId.replace(/^event\./, '').replace(new RegExp(`${VOICE_EVENT_SUFFIX}$`), '').replace(/_/g, ' ');
}

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * One history state → one utterance, or null.
 *
 * An event entity's STATE is the ISO time it last fired; `unknown` and
 * `unavailable` are the entity existing without having fired, and the history
 * API also returns the state that was current at the window's start, which is
 * an event already seen — the id makes that a duplicate rather than a problem.
 * A fire with no command text is dropped: there is nothing to show or ask
 * about, and it is usually a wake word with nothing after it.
 */
export function parseVoiceState(s: HAHistoryState, rooms: Record<string, string | null> = {}): ParsedUtterance | null {
  if (!isVoiceEventEntity(s.entity_id)) return null;
  const at = Date.parse(s.state);
  if (!Number.isFinite(at)) return null;
  const a = s.attributes ?? {};
  const command = text(a.voice_command);
  if (!command) return null;
  const occurredAt = new Date(at);
  return {
    id: `${s.entity_id}|${occurredAt.toISOString()}`,
    entityId: s.entity_id,
    device: deviceName(s.entity_id, a.friendly_name),
    room: rooms[s.entity_id] ?? null,
    occurredAt,
    command,
    reply: text(a.voice_reply),
    intent: text(a.intent),
    personName: text(a.person_first_name),
    personType: text(a.person_type),
  };
}

/** A whole `/api/history/period` response (one array per entity) → unique rows. */
export function parseVoiceHistory(series: unknown, rooms: Record<string, string | null> = {}): ParsedUtterance[] {
  if (!Array.isArray(series)) return [];
  const out = new Map<string, ParsedUtterance>();
  for (const list of series) {
    if (!Array.isArray(list)) continue;
    // HA's history leaves `entity_id` off every state after the first in a
    // series when asked for a minimal response; carry it forward either way.
    let entityId = '';
    for (const raw of list as HAHistoryState[]) {
      if (raw?.entity_id) entityId = raw.entity_id;
      const row = parseVoiceState({ ...raw, entity_id: raw?.entity_id || entityId }, rooms);
      if (row) out.set(row.id, row);
    }
  }
  return [...out.values()];
}

/** The newest stored row per device, as far as replay detection needs it. */
export interface LastHeard {
  id: string;
  command: string;
  reply: string | null;
}

/**
 * Drop Home Assistant's restart replays.
 *
 * The integration remembers which record it last fired in memory only, so on
 * every HA restart each device's LATEST record fires again — stamped with the
 * restart time, which can be days after it was said. A replay is exactly the
 * device's previous command and reply again, so that is what is dropped. The
 * cost is that saying the identical thing twice in a row to the same Echo keeps
 * one of the two; a restart that re-dated old speech into the busiest-hour
 * chart would cost more.
 *
 * `last` is the newest stored row per entity; a row carrying that row's own id
 * is the history window's opening state, already held, and is dropped quietly.
 */
export function dropReplays(rows: readonly ParsedUtterance[], last: Record<string, LastHeard | undefined>): ParsedUtterance[] {
  const prev: Record<string, LastHeard | undefined> = { ...last };
  const out: ParsedUtterance[] = [];
  for (const r of [...rows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    const p = prev[r.entityId];
    if (p && (p.id === r.id || (p.command === r.command && (p.reply ?? null) === (r.reply ?? null)))) continue;
    out.push(r);
    prev[r.entityId] = { id: r.id, command: r.command, reply: r.reply };
  }
  return out;
}
