import type { HeartbeatActivity } from '$lib/db/schema';

export type PulseOutcome = 'fired' | 'ok' | 'skipped' | 'error';

export interface ActivityContext {
  /** Wall-clock at the start of this tick. */
  now: number;
  /** Per-activity config from heartbeat_activities.config. */
  config: Record<string, unknown>;
  /** The DB row driving this run; handlers may inspect last_tick_at etc. */
  activity: HeartbeatActivity;
}

export interface ActivityResult {
  outcome: PulseOutcome;
  summary: string;                       // <= 200 chars
  details?: Record<string, unknown>;
  conversationId?: string | null;
  jobId?: string | null;
}

export interface ActivityHandler {
  /** Stable name. Matches heartbeat_activities.name. */
  name: string;
  description: string;
  defaultCadenceSeconds: number;
  defaultEnabled: boolean;
  /** Optional default active-hours window. */
  defaultActiveHours?: { start: string; end: string; tz: string };
  /** Default per-activity config (rate limits etc). */
  defaultConfig?: Record<string, unknown>;
  run(ctx: ActivityContext): Promise<ActivityResult>;
}
