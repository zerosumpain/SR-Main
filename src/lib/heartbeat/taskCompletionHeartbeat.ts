import type { PlatformCall } from '$lib/types/platform';

/**
 * Result of a heartbeat task-completion check.
 */
export interface HeartbeatCheckResult {
  /** True when there are no pending follow-ups, no active workflows, and no scheduled callbacks. */
  allLanded: boolean;
  /** Count of pending (not completed/cancelled) follow-ups. */
  pendingFollowUps: number;
  /** Count of workflows that are currently running or queued. */
  activeWorkflows: number;
  /** Count of scheduled callbacks that are still in the future. */
  scheduledTasks: number;
  /** Human-readable summary of what is still pending, or a confirmation that everything is landed. */
  summary: string;
  /** ISO timestamp of when the check was performed. */
  checkedAt: string;
}

/**
 * Intercepts a 'heartbeat' message and checks whether there is anything pending
 * across follow-ups, workflows, and scheduled tasks.
 *
 * @param platform - The platform call interface (platform.call).
 * @param message - The raw heartbeat message payload (optional, currently unused but kept for future use).
 * @returns A structured result describing pending work.
 */
export async function handleHeartbeat(
  platform: PlatformCall,
  _message?: unknown
): Promise<HeartbeatCheckResult> {
  const checkedAt = new Date().toISOString();

  // Gather status from the three areas in parallel where possible.
  const [followUps, workflows, scheduled] = await Promise.allSettled([
    listPendingFollowUps(platform),
    listActiveWorkflows(platform),
    listScheduledCallbacks(platform),
  ]);

  const pendingFollowUps = followUps.status === 'fulfilled' ? followUps.value : 0;
  const activeWorkflows = workflows.status === 'fulfilled' ? workflows.value : 0;
  const scheduledTasks = scheduled.status === 'fulfilled' ? scheduled.value : 0;

  const allLanded = pendingFollowUps === 0 && activeWorkflows === 0 && scheduledTasks === 0;

  const parts: string[] = [];
  if (pendingFollowUps > 0) {
    parts.push(`${pendingFollowUps} pending follow-up${pendingFollowUps === 1 ? '' : 's'}`);
  }
  if (activeWorkflows > 0) {
    parts.push(`${activeWorkflows} active workflow${activeWorkflows === 1 ? '' : 's'}`);
  }
  if (scheduledTasks > 0) {
    parts.push(`${scheduledTasks} scheduled task${scheduledTasks === 1 ? '' : 's'}`);
  }

  const summary = allLanded
    ? 'Everything is landed — no pending follow-ups, active workflows, or scheduled tasks.'
    : `Still pending: ${parts.join(', ')}.`;

  return {
    allLanded,
    pendingFollowUps,
    activeWorkflows,
    scheduledTasks,
    summary,
    checkedAt,
  };
}

/**
 * Lists follow-ups that are still pending (not completed or cancelled).
 */
async function listPendingFollowUps(platform: PlatformCall): Promise<number> {
  try {
    const result = await platform.call('followups', 'followup_status', {});
    const items = extractArray(result);
    return items.filter((item) => {
      const status = String(item?.status ?? '').toLowerCase();
      return status !== 'completed' && status !== 'cancelled' && status !== 'done';
    }).length;
  } catch {
    // If the tool is unavailable, treat as zero pending (fail-open).
    return 0;
  }
}

/**
 * Lists workflows that are currently running or queued.
 */
async function listActiveWorkflows(platform: PlatformCall): Promise<number> {
  try {
    const result = await platform.call('workflows', 'workflow_list', {});
    const items = extractArray(result);
    return items.filter((item) => {
      const status = String(item?.status ?? '').toLowerCase();
      return status === 'running' || status === 'queued' || status === 'active' || status === 'pending';
    }).length;
  } catch {
    return 0;
  }
}

/**
 * Lists scheduled callbacks that are still in the future.
 */
async function listScheduledCallbacks(platform: PlatformCall): Promise<number> {
  try {
    const result = await platform.call('schedule', 'list_scheduled_callbacks', {});
    const items = extractArray(result);
    const now = Date.now();
    return items.filter((item) => {
      const at = item?.at ?? item?.scheduledAt ?? item?.runAt ?? item?.time;
      if (!at) return false;
      const ts = new Date(at).getTime();
      return !Number.isNaN(ts) && ts > now;
    }).length;
  } catch {
    return 0;
  }
}

/**
 * Safely extracts an array from a platform tool response.
 * Handles both direct arrays and { items, data, results, list } wrappers.
 */
function extractArray(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    for (const key of ['items', 'data', 'results', 'list', 'followups', 'workflows', 'callbacks']) {
      const val = obj[key];
      if (Array.isArray(val)) return val;
    }
  }
  return [];
}
