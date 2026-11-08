import { db } from '$lib/db';
import { jkaiBuildDeliveries, jkaiBuilds, researchSessions, workflowRuns, workflows, nodeExecutions } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { publishedLabel, publishedLink } from '$lib/builds/published-link';
import { deliveryFacts, deliveryLine } from '$lib/jkai/commission/commission';
import type { DeliveryState } from '$lib/constants/development';

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
 *     on the tool that creates it (in src/lib/tools/tools/*)
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
    // published_slug also holds a change request's PR URL or a compare ref, so
    // it is resolved rather than prefixed: a bare `/${slug}` printed
    // `/https://github.com/…/pull/416` into the heartbeat prompt.
    const published = publishedLink(b.publishedSlug);
    const publishedText = published?.href ?? publishedLabel(b.publishedSlug);
    if (publishedText) lines.push(`  published:         ${publishedText}`);
    return {
      contextBlock: lines.join('\n'),
      terminal: TERMINAL_BUILD_STATUSES.has(b.status),
      summary: `${b.status} — iter ${b.iterationsCompleted}`,
    };
  },

  /**
   * A commissioned build (`develop_commission`): its delivery, not the build
   * row, because the stage, criteria, preview and pull request live there.
   * Terminal at a pull request, shipped, waiting on the owner, or stopped, so
   * the watcher reports the outcome once and retires. The summary is the one
   * line the thread reads; it carries no cost or clock, so it changes (and the
   * targeted runner posts) only when the stage does.
   */
  delivery: async (taskId) => {
    const [row] = await db
      .select({ state: jkaiBuildDeliveries.state, title: jkaiBuilds.title, outcome: jkaiBuilds.outcome, costUsd: jkaiBuilds.costUsd, status: jkaiBuilds.status })
      .from(jkaiBuildDeliveries)
      .innerJoin(jkaiBuilds, eq(jkaiBuilds.id, jkaiBuildDeliveries.buildId))
      .where(eq(jkaiBuildDeliveries.buildId, taskId))
      .limit(1);
    if (!row) return { contextBlock: `(delivery ${taskId} not found)`, terminal: true };
    const f = deliveryFacts(row.state as DeliveryState, row.outcome);
    const line = deliveryLine(f);
    const lines = [
      `LATEST DELIVERY STATE`,
      `  id:            ${taskId}`,
      `  title:         ${row.title ?? ''}`,
      `  stage:         ${f.stageWord}`,
      `  criteria met:  ${f.criteria.met} of ${f.criteria.total}`,
      `  build status:  ${row.status}`,
      `  cost so far:   $${row.costUsd}`,
      `  workspace:     /jkai/develop/${taskId}`,
    ];
    if (f.previewUrl) lines.push(`  preview:       ${f.previewUrl}`);
    if (f.prUrl) lines.push(`  pull request:  ${f.prUrl}`);
    if (f.awaitingOwner) lines.push(`  waiting on you: ${f.awaitingOwner.slice(0, 200)}`);
    if (f.stopReason) lines.push(`  stopped:       ${f.stopReason.slice(0, 200)}`);
    return { contextBlock: lines.join('\n'), terminal: f.terminal, summary: line };
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

