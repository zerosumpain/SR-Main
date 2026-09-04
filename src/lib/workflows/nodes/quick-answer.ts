import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { quickAnswers } from '$lib/db/schema';
import { runQuickAnswerSync, requestStop } from '$lib/quickanswer/worker';
import { quickAnswerDef } from './quick-answer.def';
export { quickAnswerDef } from './quick-answer.def';

export const quickAnswerExecutor: NodeExecutor = {
  type: 'quick-answer',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const topicTemplate = typeof config.topic === 'string' ? (config.topic as string) : '';
    const topic = interpolateTemplate(topicTemplate, input).trim();
    if (!topic) {
      return { output: { ...input, success: false, error: 'Topic is required' }, rowCount: 1 };
    }

    const goalsRaw = (config.goals as unknown) ?? [];
    const goals: string[] = Array.isArray(goalsRaw)
      ? (goalsRaw as unknown[]).map((g) => interpolateTemplate(String(g), input))
      : [];

    const maxWaitMs =
      typeof config.maxWaitMs === 'number' ? (config.maxWaitMs as number) : 180_000;

    const [inserted] = await db
      .insert(quickAnswers)
      .values({ topic, goals, status: 'pending' })
      .returning({ id: quickAnswers.id });
    const id = inserted.id;

    // Run in-process and await directly. A wall-clock deadline still applies:
    // if it elapses, signal the worker to stop and fall back to whatever the
    // DB row currently holds.
    const deadlineTimer = setTimeout(() => requestStop(id), maxWaitMs);
    let last: typeof quickAnswers.$inferSelect;
    try {
      last = await runQuickAnswerSync(id);
    } finally {
      clearTimeout(deadlineTimer);
    }

    return {
      output: {
        ...input,
        success: last.status === 'complete',
        error: last.status === 'failed' ? (last.errorMessage ?? 'Failed') : undefined,
        researchEngine: 'quick' as const,
        researchStatus: last.status,
        researchTopic: last.topic,
        researchReport: last.answer ?? '',
        researchSources: last.sources ?? [],
        researchSessionId: id,
        researchDurationMs: last.durationMs ?? undefined,
      },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'topic is templated from {{input.*}} and config.topic.' };
  },
  getOutputSchema() {
    return { type: 'object', description: 'Quick answer report + sources; polls until complete.' };
  },
};
