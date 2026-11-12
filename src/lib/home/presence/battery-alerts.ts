// src/lib/home/presence/battery-alerts.ts
//
// "Rory's phone is on 14%" — told to the people who follow them, once, before
// the phone goes dark and the map stops answering (review 2026-11-09, O5).
// PURE; delivery is ./battery-alerts.server.
//
// One alert per discharge: it fires at LOW_PCT and is not told again until
// the battery has been back above REARM_PCT (charged), so a phone hovering at
// 14–16 % does not ring the family every few minutes. Only on a reading
// fresher than FRESH_MINS: a battery figure from this morning says nothing
// about now.

import type { PushMessage } from '$lib/server/apns';
import { householdUserInfo } from './alerts';

/** Told at or below this. The floor at which close tracking gives up the GPS too. */
export const LOW_PCT = 15;
/** Re-armed once a reading is back at or above this. */
export const REARM_PCT = 30;
/** A reading older than this is not acted on, either way. */
export const FRESH_MINS = 30;
/** An alert still unsent after this long is not news. */
export const BATTERY_TTL_S = 60 * 60;

/** Stored per subject in app_settings `home.presence.battery.<subject>`. */
export interface BatteryState {
  /** May an alert fire on the next low reading? */
  armed: boolean;
  /** The alert of the current discharge, once raised. */
  id?: string;
  /** Recipients it reached. */
  to?: string[];
  /** Until when the current alert may still be sent to the rest. */
  until?: number;
}

export interface BatteryReading {
  pct: number;
  at: Date;
}

export interface BatteryStep {
  state: BatteryState;
  /** The alert to send to `recipients`, or null. */
  notice: { id: string; recipients: string[]; push: PushMessage; until: number } | null;
}

const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/**
 * One person's step: given their newest battery reading and what was stored,
 * the state to store and the alert (if any) still owed. PURE.
 *
 * `recipients` are the followers on the app, lower-cased. A partly delivered
 * alert is retried to the rest until its `until`.
 */
export function batteryStep(input: {
  subject: string;
  name: string;
  reading: BatteryReading | null;
  state: BatteryState | null;
  recipients: readonly string[];
  now: Date;
}): BatteryStep {
  const { subject, name, reading, now } = input;
  const state: BatteryState = input.state ?? { armed: true };
  if (!reading || +now - +reading.at > FRESH_MINS * 60_000) return { state, notice: null };
  if (reading.pct >= REARM_PCT) return { state: { armed: true }, notice: null };

  // An alert of this discharge still owed to someone.
  if (state.id && state.until && +now <= state.until) {
    const done = new Set(state.to ?? []);
    const pending = input.recipients.filter((r) => !done.has(r));
    if (!pending.length) return { state, notice: null };
    return { state, notice: notice(state.id, subject, name, reading, pending, state.until) };
  }
  if (!state.armed || reading.pct > LOW_PCT || !input.recipients.length) return { state, notice: null };

  const id = `battery-${subject}-${+reading.at}`;
  const until = +now + BATTERY_TTL_S * 1000;
  return {
    state: { armed: false, id, to: [], until },
    notice: notice(id, subject, name, reading, [...input.recipients], until),
  };
}

function notice(id: string, subject: string, name: string, reading: BatteryReading, recipients: string[], until: number) {
  const push: PushMessage = {
    title: `${name}'s phone is on ${Math.round(reading.pct)}%`,
    body: `At ${clockFmt.format(reading.at)}. Their location may stop updating soon.`,
    tier: 'normal',
    category: 'household',
    threadId: 'household',
    level: 'active',
    relevance: 0.6,
    collapseId: id.slice(0, 64),
    userInfo: householdUserInfo(id, 'battery', subject),
    ttlSeconds: BATTERY_TTL_S,
  };
  return { id, recipients, push, until };
}

/** After a send: the state with whoever it reached recorded. PURE. */
export function recordBatterySent(state: BatteryState, reached: Iterable<string>): BatteryState {
  return { ...state, to: [...new Set([...(state.to ?? []), ...reached])] };
}
