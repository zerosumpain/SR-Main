import type { HeartbeatAction } from '$lib/db/schema';

export type PulseOutcome = 'fired' | 'ok' | 'skipped' | 'error' | 'completed';

export interface ActivityContext {
  /** Wall-clock at the start of this tick. */
  now: number;
  /** Per-action config from heartbeat_actions.config. */
  config: Record<string, unknown>;
  /** The DB row driving this run; handlers may inspect last_run_at etc. */
  action: HeartbeatAction;
}

export interface ActivityResult {
  outcome: PulseOutcome;
  summary: string;                       // <= 200 chars
  details?: Record<string, unknown>;
  conversationId?: string | null;
  jobId?: string | null;
  /** USD cost incurred by this run (LLM tokens). 0 if no LLM call. */
  costUsd?: number;
  /**
   * Set true when the handler determined the action's goal is met. The
   * engine will flip status to 'done' instead of rescheduling.
   */
  markDone?: boolean;
}

export interface ActivityHandler {
  /** Stable name. Matches heartbeat_actions.name for system-scans. */
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
