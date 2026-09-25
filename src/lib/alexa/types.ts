// What the household says to Alexa, as the rest of the site sees it.
//
// The source is Home Assistant's `alexa_devices` integration (HA ≥ 2026.6): one
// `event.<device>_voice_event` entity per Echo, which fires with the command,
// Alexa's reply, Amazon's intent and — when voice ID recognised the speaker —
// a first name. Nothing here talks to Amazon directly.

/**
 * The topic vocabulary. Fixed on purpose: a chart of free-text topics grows a
 * new bar every night ("music", "songs", "playing music") and says nothing.
 * `other` is the honest bucket, not a failure.
 */
export const VOICE_TOPICS = [
  'music',
  'timers-alarms',
  'weather',
  'time-date',
  'questions',
  'smart-home',
  'lists-shopping',
  'news',
  'calls-messages',
  'tv-video',
  'jokes-chat',
  'other',
] as const;
export type VoiceTopic = (typeof VOICE_TOPICS)[number];

export const VOICE_TOPIC_LABEL: Record<VoiceTopic, string> = {
  music: 'Music',
  'timers-alarms': 'Timers & alarms',
  weather: 'Weather',
  'time-date': 'Time & date',
  questions: 'Questions',
  'smart-home': 'Smart home',
  'lists-shopping': 'Lists & shopping',
  news: 'News',
  'calls-messages': 'Calls & messages',
  'tv-video': 'TV & video',
  'jokes-chat': 'Jokes & chat',
  other: 'Other',
};

export function isVoiceTopic(v: unknown): v is VoiceTopic {
  return typeof v === 'string' && (VOICE_TOPICS as readonly string[]).includes(v);
}

/** One utterance, ready to insert. */
export interface ParsedUtterance {
  id: string;
  entityId: string;
  device: string;
  room: string | null;
  occurredAt: Date;
  command: string;
  reply: string | null;
  intent: string | null;
  personName: string | null;
  personType: string | null;
}

/** One entity state as `/api/history/period` returns it (full response). */
export interface HAHistoryState {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
  last_changed?: string;
  /** Moves on an attribute-only change too — a new track while already playing. */
  last_updated?: string;
}

/**
 * Everything else an Echo reports through Home Assistant (`alexa_signals`).
 * Room sensors and the notification sensors are POLLED by HA every five
 * minutes; `media` arrives only by Amazon's push feed, the same feed voice
 * events ride, so when that feed is down media is silent too.
 */
export const SIGNAL_KINDS = ['temperature', 'illuminance', 'motion', 'alarm', 'timer', 'reminder', 'media'] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export function isSignalKind(v: unknown): v is SignalKind {
  return typeof v === 'string' && (SIGNAL_KINDS as readonly string[]).includes(v);
}

/** One change, ready to insert. */
export interface ParsedSignal {
  id: string;
  entityId: string;
  kind: SignalKind;
  device: string;
  room: string | null;
  occurredAt: Date;
  value: number | null;
  text: string | null;
  detail: Record<string, unknown> | null;
}
