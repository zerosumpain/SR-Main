// Personalized Briefing Engine — a scheduled digest that gathers what you care
// about (question intents, recent research, live vitals/signals), synthesises it
// with the LLM, stores it, and delivers it over WhatsApp. Mirrors the proven
// self-improvement harness (host/kill gates, datastore dogfooding), trimmed to a
// single gather→synthesise→deliver flow.

export const BRIEFINGS_COLLECTION = 'briefings';
export const FEEDBACK_COLLECTION = 'briefing-feedback';
export const SETTINGS_ENABLED_KEY = 'briefing.enabled';
export const SETTINGS_TOPICS_KEY = 'briefing.topics';

export const CRON_EXPR = '30 6 * * *'; // 06:30 daily
export const CRON_TZ = 'Europe/London';

/**
 * The canvas workflow that actually produces the briefing. It gathers the
 * signals, composes a verified fact sheet, sends the WhatsApp summary and
 * writes the detail into the `briefings` collection for /jkai/briefing.
 */
export const BRIEFING_WORKFLOW_NAME = 'canvas:morning-briefing';

export const SYSTEM_ACTOR = 'system';
export const OWNER_PHONE = '+447359228511';

// `workflow:*` is required because the briefing is written by the
// canvas:morning-briefing workflow, whose datastore actor is `workflow:<id>`.
export const BRIEFING_PERMS = {
  read: ['owner', 'jkai', 'system', 'workflow:*'],
  write: ['system', 'owner', 'workflow:*'],
  delete: ['owner', 'system'],
};

/** One gathered signal and whether it actually produced anything. */
export interface BriefingSourceRow {
  key: string;
  label: string;
  status: 'ok' | 'failed' | 'stale' | 'empty';
  /** The value when ok, the reason when not. */
  detail: string;
  error?: string | null;
}

export interface BriefingFactRow {
  section: string;
  label: string;
  value: string;
  source: string;
}

/**
 * The full detail behind a briefing — everything the WhatsApp summary had to
 * leave out, plus the evidence for every claim it made. Written by the
 * `briefing-compose` node so the page and the message share one source of
 * truth; absent on briefings produced before 2026-07-29.
 */
export interface BriefingDetail {
  headline: string;
  dateLabel: string;
  generatedAt: string;
  timezone: string;
  location: Record<string, unknown> | null;
  weather: {
    home: Record<string, unknown> | null;
    here: Record<string, unknown> | null;
    /** True when you are at home, so "here" would duplicate "home". */
    sameSpot: boolean;
  } | null;
  knowledge: { query: string | null; context: string } | null;
  facts: BriefingFactRow[];
  gaps: Array<{ section: string; reason: string }>;
  sources: BriefingSourceRow[];
}

export interface BriefingData {
  id: string;
  trigger: 'cron' | 'manual' | 'workflow';
  status: 'running' | 'complete' | 'failed' | 'skipped_disabled';
  startedAt: string;
  finishedAt?: string;
  title: string;
  /** The synthesised digest (markdown). */
  markdown: string;
  /** Which signal sources contributed. */
  sources: string[];
  llmCalls: number;
  costUsd: number;
  error?: string;
  /** Structured evidence — see BriefingDetail. */
  detail?: BriefingDetail;
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Cast a typed record to the datastore's generic data bag. */
export function asData<T>(value: T): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

/** e.g. "Fri 19 Jul" for a briefing title. */
export function briefingDateLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
