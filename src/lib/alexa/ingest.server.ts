// Pulling what was said to Alexa out of Home Assistant and keeping it.
//
// Pull, not push: HA's recorder keeps thirty days, so reading history from the
// last row we hold (minus an overlap) means a VPS outage, a tailnet blip or a
// slow deploy costs nothing — the next run reads the gap. A webhook from an HA
// automation would lose every utterance spoken while this end was down, and
// would be one more piece of logic living in HA, which holds none today.

import { desc, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { alexaUtterances } from '$lib/db/schema';
import { emit as emitPlatformEvent } from '$lib/events/platform-bus';
import { isVoiceEventEntity, newSpeech, parseVoiceHistory, type LastHeard } from './parse';
import type { ParsedUtterance } from './types';

/** Re-read this much before the newest row we hold. Rows are keyed, so it is free. */
const OVERLAP_MS = 2 * 3_600_000;
/** How far back the very first run reaches. HA itself keeps thirty days. */
const FIRST_RUN_MS = 29 * 86_400_000;
/**
 * Nothing before this is read. HA was upgraded to a version with voice events
 * at 17:52 UTC on 2026-09-24, and its first fire (17:59:57) was the restart
 * replay `dropReplays` describes — each Echo's last record from hours or days
 * earlier, all stamped 17:59:57.270 — with nothing stored yet to recognise it
 * against. Everything after is live.
 */
export const LOG_STARTS_AT = Date.parse('2026-09-24T18:00:00Z');

export interface VoiceSyncResult {
  ok: boolean;
  error?: string;
  devices: number;
  read: number;
  /** Fires dropped as restart replays or the already-held window start. */
  replays?: number;
  inserted: number;
  since: string | null;
}

/**
 * The slice of the Home Assistant service this needs. Passed in rather than
 * imported: `$lib/workflows` imports this module's tools, and reaching back
 * into it from here would make the two a cycle.
 */
export interface VoiceSource {
  isConfigured(): boolean;
  queryAllStates(): Promise<HAResult>;
  getHistory(entityId: string, start?: string): Promise<HAResult>;
  renderTemplate(template: string): Promise<HAResult>;
}
interface HAResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Area name per voice entity, in one template call. Best-effort: a room is a
 * label on the page, and an HA with no areas set simply shows none.
 */
async function roomsFor(service: VoiceSource, ids: string[]): Promise<Record<string, string | null>> {
  if (ids.length === 0) return {};
  const res = await service.renderTemplate(`{{ ${JSON.stringify(ids)} | map('area_name') | list | tojson }}`);
  const raw = (res.data as { result?: unknown } | undefined)?.result;
  try {
    const names: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(names)) return {};
    return Object.fromEntries(ids.map((id, i) => [id, typeof names[i] === 'string' ? (names[i] as string) : null]));
  } catch {
    return {};
  }
}

export async function syncVoiceHistory(service: VoiceSource, now = Date.now()): Promise<VoiceSyncResult> {
  const empty: VoiceSyncResult = { ok: false, devices: 0, read: 0, inserted: 0, since: null };
  if (!service.isConfigured()) return { ...empty, error: 'home assistant not configured' };

  const states = await service.queryAllStates();
  if (!states.success || !Array.isArray(states.data)) {
    return { ...empty, error: states.error ?? 'no states returned' };
  }
  const ids = (states.data as { entity_id: string }[])
    .map((s) => s.entity_id)
    .filter(isVoiceEventEntity)
    .sort();
  if (ids.length === 0) {
    return { ...empty, error: 'no alexa_devices voice event entities (needs HA 2026.6+ and the Alexa Devices integration)' };
  }

  const [latest] = await db
    .select({ at: sql<Date | null>`max(${alexaUtterances.occurredAt})` })
    .from(alexaUtterances);
  const newest = latest?.at ? new Date(latest.at).getTime() : null;
  const since = new Date(Math.max(LOG_STARTS_AT, newest ? newest - OVERLAP_MS : now - FIRST_RUN_MS)).toISOString();

  const [history, rooms] = await Promise.all([
    service.getHistory(ids.join(','), since),
    roomsFor(service, ids),
  ]);
  if (!history.success) return { ...empty, devices: ids.length, since, error: history.error ?? 'history read failed' };

  const lastRows = await db
    .selectDistinctOn([alexaUtterances.entityId], {
      entityId: alexaUtterances.entityId,
      id: alexaUtterances.id,
      command: alexaUtterances.command,
      reply: alexaUtterances.reply,
    })
    .from(alexaUtterances)
    .orderBy(alexaUtterances.entityId, desc(alexaUtterances.occurredAt));
  const last: Record<string, LastHeard> = Object.fromEntries(lastRows.map((r) => [r.entityId, r]));
  // HA returns the state current at `since` too, which can predate it.
  const parsed = parseVoiceHistory(history.data, rooms);
  const rows = newSpeech(parsed, last, LOG_STARTS_AT);
  let inserted = 0;
  if (rows.length > 0) {
    const out = await db
      .insert(alexaUtterances)
      .values(rows)
      .onConflictDoNothing({ target: alexaUtterances.id })
      .returning({ id: alexaUtterances.id });
    inserted = out.length;
    announce(rows, new Set(out.map((r) => r.id)), now);
  }
  return { ok: true, devices: ids.length, read: parsed.length, replays: parsed.length - rows.length, inserted, since };
}

/** Only speech from the last half hour is an event; a backfill is history. */
const EVENT_WINDOW_MS = 30 * 60 * 1000;
const MAX_EVENTS_PER_SYNC = 20;

/** One `alexa.utterance` per newly stored, recent utterance. */
function announce(rows: readonly ParsedUtterance[], inserted: Set<string>, now: number): void {
  const fresh = rows
    .filter((r) => inserted.has(r.id) && now - r.occurredAt.getTime() <= EVENT_WINDOW_MS)
    .slice(-MAX_EVENTS_PER_SYNC);
  for (const r of fresh) {
    emitPlatformEvent(
      'alexa.utterance',
      {
        id: r.id,
        device: r.device,
        room: r.room,
        command: r.command,
        reply: r.reply,
        intent: r.intent,
        person: r.personName,
        occurredAt: r.occurredAt.toISOString(),
      },
      { source: 'alexa-voice' },
    );
  }
}
