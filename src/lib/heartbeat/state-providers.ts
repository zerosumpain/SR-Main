import { db } from '$lib/db';
import { jkaiBuilds, researchSessions, workflowRuns, workflows, nodeExecutions } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';

/**
 * Pluggable per-task-kind state providers. Each entry is responsible for:
 *   1. fetching the live row(s) for the given task id
 *   2. formatting a system-context block the heartbeat engine prepends
 *      to the LLM prompt on each tick
 *   3. signalling whether the task has reached a terminal state — the
 *      engine uses this so the LLM doesn't have to guess
 *
 * Adding a new kind:
 *   - declare `producesLongRunningTask: { kind: 'foo', idPath: '...' }`
 *     on the tool that creates it (in src/lib/workflows/site-tools/tools/*)
 *   - add an entry here mapping that kind to a fetch+format function
 *
 * No other code change is needed — the auto-register wrapper and the
 * heartbeat targeted runner both look up by kind.
 */

export interface TaskStateSnapshot {
  /** Markdown-ish block to prepend to the heartbeat prompt. */
  contextBlock: string;
  /** True when the task has settled — engine signals the LLM to reply DONE. */
  terminal: boolean;
  /** Optional one-liner the engine can use as the pulse summary. */
  summary?: string;
}

export type TaskStateProvider = (taskId: string) => Promise<TaskStateSnapshot | null>;

const TERMINAL_BUILD_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const TERMINAL_RESEARCH_STATUSES = new Set(['complete', 'completed', 'failed', 'cancelled']);
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);

const providers: Record<string, TaskStateProvider> = {
  build: async (taskId) => {
    const [b] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, taskId)).limit(1);
    if (!b) return { contextBlock: `(build ${taskId} not found)`, terminal: true };
    const lines = [
      `LATEST BUILD STATE`,
      `  id:                ${b.id}`,
      `  status:            ${b.status}`,
      `  iterations done:   ${b.iterationsCompleted}`,
      `  active minutes:    ${b.activeMinutesUsed}`,
      `  cost so far:       $${b.costUsd}`,
      `  consecutive fails: ${b.consecutiveFailures}`,
      `  updated_at:        ${b.updatedAt}`,
    ];
    if (b.failure) lines.push(`  failure:           ${JSON.stringify(b.failure).slice(0, 200)}`);
    if (b.publishedSlug) lines.push(`  published:         /${b.publishedSlug}`);
    return {
      contextBlock: lines.join('\n'),
      terminal: TERMINAL_BUILD_STATUSES.has(b.status),
      summary: `${b.status} — iter ${b.iterationsCompleted}`,
    };
  },

  research: async (taskId) => {
    const [r] = await db.select().from(researchSessions).where(eq(researchSessions.id, taskId)).limit(1);
    if (!r) return { contextBlock: `(research ${taskId} not found)`, terminal: true };
    const row = r as { id: string; status?: string; topic?: string; updatedAt?: unknown };
    const status = row.status ?? 'unknown';
    return {
      contextBlock: [
        `LATEST RESEARCH STATE`,
        `  id:      ${row.id}`,
        `  status:  ${status}`,
        `  topic:   ${row.topic?.slice(0, 80) ?? ''}`,
        `  updated: ${row.updatedAt ?? ''}`,
      ].join('\n'),
      terminal: TERMINAL_RESEARCH_STATUSES.has(status),
      summary: `research ${status}`,
    };
  },

  workflow_run: async (taskId) => {
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, taskId)).limit(1);
    if (!run) return { contextBlock: `(workflow run ${taskId} not found)`, terminal: true };
    const [wf] = run.workflowId
      ? await db.select({ name: workflows.name }).from(workflows).where(eq(workflows.id, run.workflowId)).limit(1)
      : [{ name: '(unknown)' }];
    const recentNodes = await db
      .select({ nodeId: nodeExecutions.nodeId, status: nodeExecutions.status, completedAt: nodeExecutions.completedAt, error: nodeExecutions.error })
      .from(nodeExecutions)
      .where(eq(nodeExecutions.runId, taskId))
      .orderBy(desc(nodeExecutions.startedAt))
      .limit(8);
    const lines = [
      `LATEST WORKFLOW RUN STATE`,
      `  run id:      ${run.id}`,
      `  workflow:    ${wf?.name ?? run.workflowId}`,
      `  status:      ${run.status}`,
      `  trigger:     ${run.trigger}`,
      `  started:     ${run.startedAt}`,
      `  heartbeat:   ${run.heartbeatAt ?? '—'}`,
      run.completedAt ? `  completed:   ${run.completedAt}` : '',
      run.error ? `  error:       ${run.error.slice(0, 200)}` : '',
      `  nodes (latest 8):`,
      ...recentNodes.map((n) => `    - ${n.nodeId}  ${n.status}${n.error ? `  ERR: ${n.error.slice(0, 80)}` : ''}`),
    ].filter(Boolean);
    return {
      contextBlock: lines.join('\n'),
      terminal: TERMINAL_RUN_STATUSES.has(run.status),
      summary: `${wf?.name ?? 'workflow'} run — ${run.status}`,
    };
  },
};

export function getTaskStateProvider(kind: string): TaskStateProvider | null {
  return providers[kind] ?? null;
}

export function listKnownTaskKinds(): string[] {
  return Object.keys(providers);
}
