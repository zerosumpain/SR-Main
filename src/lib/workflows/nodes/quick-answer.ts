import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { quickAnswers } from '$lib/db/schema';
import { runQuickAnswerSync, requestStop } from '$lib/quickanswer/worker';

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
      maxWaitMs: { type: 'number' },
    },
    required: ['topic'],
  },
  defaultConfig: { topic: '{{item.title}}', goals: [], maxWaitMs: 180000 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Answer' }],
  basicConfig: [
    {
      key: 'topic',
      label: 'Topic',
      type: 'template-textarea',
      placeholder: 'What is the impact of …',
      description: 'Topic to research. Supports {{input.*}} / {{item.*}} placeholders.',
      section: 'QUERY',
    },
    {
      key: 'goals',
      label: 'Goals',
      type: 'template-textarea',
      placeholder: 'Understand key players, risks, opportunities',
      description: 'Optional: specific questions or angles. One per line.',
      section: 'QUERY',
    },
    {
      key: 'maxWaitMs',
      label: 'Max wait (ms)',
      type: 'number',
      description: 'Polling deadline before giving up.',
      placeholder: '180000',
      section: 'ADVANCED',
    },
  ],
  llmDescription: `Run a fast single-topic research session (Tavily search + LLM synthesis) and wait for it to complete. Returns a written answer plus sources. Cheaper/faster than the full \`deep-research\` node — use for a quick briefing on one \`topic\` (supports {{input.*}}/{{item.*}}). Output includes researchReport, researchSources, researchStatus.`,
  llmExamples: [
    { topic: 'Latest developments in {{input.subject}}' },
    { topic: '{{item.title}}', goals: ['key players', 'risks'] },
  ],
};
