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

export const SYSTEM_ACTOR = 'system';
export const OWNER_PHONE = '+447359228511';

export const BRIEFING_PERMS = {
  read: ['owner', 'jkai', 'system'],
  write: ['system', 'owner'],
  delete: ['owner', 'system'],
};

export interface BriefingData {
  id: string;
  trigger: 'cron' | 'manual';
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
