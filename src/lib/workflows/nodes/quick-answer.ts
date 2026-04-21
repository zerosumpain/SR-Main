import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { quickAnswers } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { startQuickAnswer } from '$lib/quickanswer/worker';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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
      return { output: { ...input, success: false, error: 'Topic is required' } };
    }

    const goalsRaw = (config.goals as unknown) ?? [];
    const goals: string[] = Array.isArray(goalsRaw)
      ? (goalsRaw as unknown[]).map((g) => interpolateTemplate(String(g), input))
      : [];

    const pollIntervalMs =
      typeof config.pollIntervalMs === 'number' ? (config.pollIntervalMs as number) : 1500;
    const maxWaitMs =
      typeof config.maxWaitMs === 'number' ? (config.maxWaitMs as number) : 180_000;

    const [inserted] = await db
      .insert(quickAnswers)
      .values({ topic, goals, status: 'pending' })
      .returning({ id: quickAnswers.id });
    const id = inserted.id;

    // Fire-and-forget worker.
    startQuickAnswer(id).catch((err) => {
      console.error('[quick-answer] worker failed:', err);
    });

    const deadline = Date.now() + maxWaitMs;
    let last: typeof quickAnswers.$inferSelect | null = null;
    while (Date.now() < deadline) {
      const [row] = await db.select().from(quickAnswers).where(eq(quickAnswers.id, id)).limit(1);
      if (row) last = row;
      if (row && (row.status === 'complete' || row.status === 'failed')) break;
      await sleep(pollIntervalMs);
    }

    if (!last) {
      return { output: { ...input, success: false, error: 'No row after insert', researchSessionId: id } };
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
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'topic is templated from {{input.*}} and config.topic.' };
  },
  getOutputSchema() {
    return { type: 'object', description: 'Quick answer report + sources; polls until complete.' };
  },
};

export const quickAnswerDef: NodeDefinition = {
  type: 'quick-answer',
  label: 'Quick Answer',
  category: 'core',
  description:
    'Run a quick-answer session (Tavily + synthesis). Polls until complete; returns the answer and sources.',
  configSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      goals: { type: 'array', items: { type: 'string' } },
      pollIntervalMs: { type: 'number' },
      maxWaitMs: { type: 'number' },
    },
    required: ['topic'],
  },
  defaultConfig: { topic: '{{item.title}}', goals: [], pollIntervalMs: 1500, maxWaitMs: 180000 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Answer' }],
  basicConfig: [
    {
      key: 'topic',
      label: 'Topic',
      type: 'template-textarea',
      description: 'Topic to research. Supports {{input.*}} / {{item.*}} placeholders.',
      section: 'QUERY',
    },
  ],
};
