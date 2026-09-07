export interface ActivityBuild { status: string; heartbeatAt?: string | null; updatedAt?: string; iterationsCompleted?: number; failure?: { message?: string; kind?: string } | null }
export function activityStatus(build: ActivityBuild, lastOutput: number, now: number, needsOwner = false) {
  if (needsOwner) return { label: 'Waiting for your decision', detail: 'Open the decisions below to unblock implementation.', warning: true };
  if (build.status !== 'running') {
    const labels: Record<string, string> = { queued: 'Queued — waiting for a worker', paused: 'Build paused', stopped: 'Build stopped', failed: 'Build failed', completed: 'Iteration work finished' };
    return { label: labels[build.status] ?? build.status, detail: build.failure?.message ?? 'Review the saved output below for the last action and result.', warning: build.status === 'failed' };
  }
  const heartbeat = Date.parse(build.heartbeatAt ?? '');
  if (!Number.isFinite(heartbeat) || now - heartbeat > 90000) return {
    label: 'Worker heartbeat not confirmed', detail: 'The build is marked running, but its heartbeat is missing or overdue. It may be starting or disconnected; this does not prove it stopped.', warning: true,
  };
  if (lastOutput && now - lastOutput < 30000) return { label: 'Receiving build output', detail: 'The worker is responding. Code, commands and results appear as they arrive.', warning: false };
  return { label: 'Worker responding — waiting for output', detail: 'A command, model response or repository check may be in progress. Quiet output alone does not mean the build has stopped.', warning: false };
}
export function ageLabel(at: number, now: number): string {
  if (!at || !Number.isFinite(at)) return 'not observed';
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
}
export interface ActivityLog { id: number; type: string; content: string; iterationId: string | null; createdAt?: string }
/** Replayed and live copies of the same persisted event occupy one row. */
export function mergeActivityLogs(current: ActivityLog[], incoming: ActivityLog[]): ActivityLog[] {
  const rows = new Map(current.map(row => [row.id, row]));
  for (const row of incoming) rows.set(row.id, { ...row, content: row.content.slice(0, 16000) });
  return [...rows.values()].sort((a, b) => a.id - b.id).slice(-160);
}
