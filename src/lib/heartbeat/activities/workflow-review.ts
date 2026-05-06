import { db } from '$lib/db';
import { workflowRuns, workflows, nodeExecutions, heartbeatPulses } from '$lib/db/schema';
import { and, desc, eq, gt, isNotNull } from 'drizzle-orm';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import type { ActivityHandler } from '../types';

const NAME = 'workflow-review';

interface WRConfig {
  /** Look back this far for runs to consider. */
  lookbackHours?: number;
  /** Max runs to review per tick. */
  maxReviewsPerTick?: number;
  /** Soft token cap for the LLM analysis. */
  reviewMaxTokens?: number;
}

const DEFAULTS: Required<WRConfig> = {
  lookbackHours: 24,
  maxReviewsPerTick: 1,
  reviewMaxTokens: 600,
};

/**
 * Pick a recent workflow run that hasn't been reviewed by this activity
 * yet, ask the LLM to suggest improvements, and store findings in the
 * pulse audit row. Findings show up on the Pulse page; if you want them
 * posted to a conversation too, add a `destinationConversationId` to the
 * activity config and we'll mirror them there in a future iteration.
 */
export const workflowReview: ActivityHandler = {
  name: NAME,
  description:
    'Periodic LLM analysis of recent workflow runs. Picks the latest unreviewed completed/failed run from the last 24h, looks at its node-execution timeline, and writes findings to the pulse audit log. Long cadence — autonomous review, not user-facing.',
  defaultCadenceSeconds: 1800,
  defaultEnabled: true,
  defaultActiveHours: { start: '08:00', end: '22:00', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as WRConfig) };
    const since = new Date(ctx.now - cfg.lookbackHours * 3600_000);

    const reviewedIds = await db
      .select({ details: heartbeatPulses.details })
      .from(heartbeatPulses)
      .where(
        and(
          eq(heartbeatPulses.actionId, ctx.action.id),
          gt(heartbeatPulses.ts, since),
        ),
      );
    const reviewed = new Set(
      reviewedIds
        .map((p) => (p.details as { runId?: string } | null)?.runId)
        .filter((v): v is string => !!v),
    );

    const runs = await db
      .select()
      .from(workflowRuns)
      .where(
        and(
          gt(workflowRuns.startedAt, since),
          isNotNull(workflowRuns.completedAt),
        ),
      )
      .orderBy(desc(workflowRuns.completedAt))
      .limit(20);

    const candidate = runs.find((r) => !reviewed.has(r.id));
    if (!candidate) {
      return { outcome: 'ok', summary: 'no unreviewed runs in the last 24h' };
    }

    // Pull node executions for this run for richer LLM context.
    const nodes = await db
      .select()
      .from(nodeExecutions)
      .where(eq(nodeExecutions.runId, candidate.id))
      .orderBy(nodeExecutions.startedAt);

    const [wf] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, candidate.workflowId))
      .limit(1);

    const ctxStr = [
      `Workflow: ${wf?.name ?? candidate.workflowId}`,
      `Description: ${wf?.description ?? '(none)'}`,
      `Run id: ${candidate.id}  trigger=${candidate.trigger}  status=${candidate.status}`,
      `Started: ${candidate.startedAt}  Completed: ${candidate.completedAt}`,
      candidate.error ? `Error: ${candidate.error}` : '',
      '',
      'Node executions (chronological):',
      ...nodes.slice(0, 30).map((n) => {
        const dur =
          n.completedAt && n.startedAt
            ? Math.round((new Date(n.completedAt).getTime() - new Date(n.startedAt).getTime()))
            : null;
        const errSegment = n.error ? `  ERR: ${n.error.slice(0, 120)}` : '';
        return `- ${n.nodeId}  status=${n.status}${dur != null ? `  ${dur}ms` : ''}${errSegment}`;
      }),
    ]
      .filter(Boolean)
      .join('\n');

    const model = await resolveDefaultModel('chat');
    const { client, model: modelId } = await getLLMClient(model);

    const prompt = `You are reviewing a single workflow run for a personal automation site. Be terse and concrete.

${ctxStr}

Output exactly three sections, ≤80 words each:
## What happened
A 1-2 sentence neutral summary.
## Risks or anti-patterns
Bullet list of concrete concerns (timeouts, retries, missing error handling, broken contract, …). If none, write "none observed".
## One concrete improvement
A single, actionable change to the workflow nodes or config. If the run was clean, write "none — pattern looks correct".`;

    const response = await client.chat.completions.create({
      model: modelId,
      messages: [
        { role: 'system', content: 'You analyse automation runs and produce short, useful reviews. Plain markdown. No preamble.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_tokens: cfg.reviewMaxTokens,
    });

    const review = response.choices[0]?.message?.content?.trim() ?? '';
    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;

    return {
      outcome: 'fired',
      summary: `reviewed run ${candidate.id.slice(0, 8)} of ${wf?.name ?? '(workflow)'}`,
      details: {
        runId: candidate.id,
        workflowId: candidate.workflowId,
        workflowName: wf?.name ?? null,
        review,
        tokens: { prompt: promptTokens, completion: completionTokens },
      },
    };
  },
};
