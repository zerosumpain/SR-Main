import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { db } from '$lib/db';
import { quickAnswers } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

type Engine = 'deep' | 'quick';

async function fetchDeepReport(sessionId: string) {
  const result = await executeSiteTool('research_get_report', { id: sessionId });
  if (!result?.success) {
    return { status: 'failed' as const, report: '', sources: [] as any[], durationMs: undefined };
  }
  const data = (result as { data: Record<string, unknown> }).data ?? {};
  return {
    status: (data.status as 'running' | 'complete' | 'failed' | undefined) ?? 'complete',
    report: (data.report as string) ?? '',
    sources: (data.sources as any[]) ?? [],
    durationMs: data.durationMs as number | undefined,
  };
}

async function fetchQuickAnswer(sessionId: string) {
  const [row] = await db
    .select()
    .from(quickAnswers)
    .where(eq(quickAnswers.id, sessionId))
    .limit(1);
  if (!row) {
    return { status: 'failed' as const, report: '', sources: [] as any[], durationMs: undefined };
  }
  return {
    status: row.status as 'pending' | 'running' | 'complete' | 'failed',
    report: row.answer ?? '',
    sources: row.sources ?? [],
    durationMs: row.durationMs ?? undefined,
  };
}

export const researchResultExecutor: NodeExecutor = {
  type: 'research-result',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const engine = (config.engine as Engine) ?? 'deep';
    const sessionId =
      typeof config.sessionId === 'string' && config.sessionId ? (config.sessionId as string) : '';
    const topic = typeof config.topic === 'string' ? (config.topic as string) : '';

    if (!sessionId) {
      return {
        output: {
          ...input,
          researchEngine: engine,
          researchStatus: 'failed',
          researchTopic: topic,
          researchReport: '',
          researchSources: [],
          researchSessionId: '',
          researchError: 'Not commissioned',
        },
      };
    }

    const res =
      engine === 'deep' ? await fetchDeepReport(sessionId) : await fetchQuickAnswer(sessionId);

    return {
      output: {
        ...input,
        researchEngine: engine,
        researchStatus: res.status,
        researchTopic: topic,
        researchReport: res.report,
        researchSources: res.sources,
        researchSessionId: sessionId,
        researchDurationMs: res.durationMs,
      },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'No required inputs; config-driven.' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      description:
        'researchEngine, researchStatus, researchReport (markdown), researchSources[], researchSessionId.',
    };
  },
};

export const researchResultDef: NodeDefinition = {
  type: 'research-result',
  label: 'Research Result',
  category: 'core',
  description:
    'Display node for a commissioned deep/quick research session. Pulses while pending; populates when complete.',
  configSchema: {
    type: 'object',
    properties: {
      engine: { type: 'string', enum: ['deep', 'quick'] },
      sessionId: { type: 'string' },
      topic: { type: 'string' },
    },
  },
  defaultConfig: { engine: 'deep', sessionId: '', topic: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Research output' }],
  basicConfig: [
    {
      key: 'engine',
      label: 'Engine',
      type: 'dropdown',
      options: [
        { value: 'deep', label: 'Deep research' },
        { value: 'quick', label: 'Quick research' },
      ],
      section: 'SOURCE',
    },
    {
      key: 'sessionId',
      label: 'Session ID',
      type: 'template-textarea',
      description: 'Existing session ID. Supports {{input.*}} placeholders from an upstream connection.',
      placeholder: '{{input.researchSessionId}}',
      section: 'SOURCE',
    },
  ],
};
