import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { interpolateTemplate } from './template';
import { coerceDepth, depthPreset, RESEARCH_DEPTHS } from '$lib/deepdive/depth';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const deepResearchExecutor: NodeExecutor = {
  type: 'deep-research',

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

    const goalsRaw = typeof config.goals === 'string' ? (config.goals as string) : '';
    const goals = interpolateTemplate(goalsRaw, input).trim();
    // `depth` used to be passed into a research_start that did not declare the
    // parameter, so every run silently got the same default. It is a real tier
    // now; the legacy shallow/medium/deep vocabulary maps in coerceDepth.
    const depth = coerceDepth(config.depth);
    const preset = depthPreset(depth);

    const pollIntervalMs =
      typeof config.pollIntervalMs === 'number' ? (config.pollIntervalMs as number) : 5000;
    const maxWaitMs =
      typeof config.maxWaitMs === 'number' ? (config.maxWaitMs as number) : 900_000;

    // Start the research session.
    const startArgs: Record<string, unknown> = { topic, depth };
    if (goals) startArgs.goals = goals.split('\n').map((g) => g.trim()).filter(Boolean);
    if (config.scope) startArgs.scope = config.scope;

    const startResult = await executeSiteTool('research_start', startArgs);
    const startData = (startResult as { data?: Record<string, unknown> })?.data ?? {};
    const sessionId = startData.id as string | undefined;
    if (!sessionId) {
      return {
        output: {
          ...input,
          success: false,
          error: 'Failed to start research session',
          researchEngine: 'deep' as const,
          researchStatus: 'failed',
        },
        rowCount: 1,
      };
    }

    // A budgeted tier has already finished inside research_start (it awaits the
    // run rather than backgrounding it), so polling would just re-read a
    // terminal row. Only the unbounded investigation needs the poll loop.
    if (preset.budgetMs != null) {
      const status = (startData.status as string) ?? 'unknown';
      const ok = status === 'complete';
      return {
        output: {
          ...input,
          success: ok,
          ...(ok ? {} : { error: (startData.error as string) ?? `Research ${status}` }),
          researchEngine: 'deep' as const,
          researchDepth: depth,
          researchStatus: status,
          researchTopic: topic,
          researchReport: (startData.answer as string) ?? '',
          researchSources: [],
          researchSessionId: sessionId,
          researchDurationMs: startData.durationMs as number | undefined,
        },
        rowCount: 1,
      };
    }

    // Poll until complete, failed, or deadline.
    const deadline = Date.now() + maxWaitMs;
    let lastStatus = 'pending';
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      const statusResult = await executeSiteTool('research_status', { id: sessionId });
      const data = (statusResult as { data?: Record<string, unknown> })?.data ?? {};
      lastStatus = (data.status as string) ?? 'unknown';
      if (lastStatus === 'completed' || lastStatus === 'complete' || lastStatus === 'failed' || lastStatus === 'cancelled') {
        break;
      }
    }

    if (lastStatus !== 'completed' && lastStatus !== 'complete') {
      if (lastStatus === 'failed' || lastStatus === 'cancelled') {
        return {
          output: {
            ...input,
            success: false,
            error: `Research session ${lastStatus}`,
            researchEngine: 'deep' as const,
            researchStatus: lastStatus,
            researchSessionId: sessionId,
          },
          rowCount: 1,
        };
      }
      // Timeout
      return {
        output: {
          ...input,
          success: false,
          error: 'Timeout waiting for research to complete',
          researchEngine: 'deep' as const,
          researchStatus: 'timeout',
          researchSessionId: sessionId,
        },
        rowCount: 1,
      };
    }

    // Fetch report.
    const reportResult = await executeSiteTool('research_get_report', { id: sessionId });
    const reportData = (reportResult as { data?: Record<string, unknown> })?.data ?? {};
    const rawReport = reportData.report;
    let report = '';
    if (typeof rawReport === 'string') {
      report = rawReport;
    } else if (typeof rawReport === 'object' && rawReport !== null) {
      // Deep-dive stores report as JSON; prefer executive_summary
      const execSummary = (rawReport as Record<string, unknown>).executive_summary;
      report = typeof execSummary === 'string' ? execSummary : JSON.stringify(rawReport);
    }

    const sources = Array.isArray(reportData.sources)
      ? (reportData.sources as Array<{ url: string; title: string; domain: string }>)
      : [];

    const durationMs = typeof reportData.durationMs === 'number' ? (reportData.durationMs as number) : undefined;

    return {
      output: {
        ...input,
        success: true,
        researchEngine: 'deep' as const,
        researchStatus: 'complete',
        researchTopic: topic,
        researchReport: report,
        researchSources: sources,
        researchSessionId: sessionId,
        researchDurationMs: durationMs,
      },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'topic is templated from {{input.*}} and config.topic.' };
  },
  getOutputSchema() {
    return { type: 'object', description: 'Deep research report + sources; polls until complete.' };
  },
};

export const deepResearchDef: NodeDefinition = {
  type: 'deep-research',
  label: 'Deep Research',
  category: 'core',
  description:
    'DAG-driven deep research (commission via pipeline). Emits researchReport + sources.',
  configSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      goals: { type: 'string' },
      depth: { type: 'string', enum: [...RESEARCH_DEPTHS] },
      pollIntervalMs: { type: 'number' },
      maxWaitMs: { type: 'number' },
    },
    required: ['topic'],
  },
  defaultConfig: {
    topic: '{{item.title}}',
    goals: '',
    depth: 'brief',
    pollIntervalMs: 5000,
    maxWaitMs: 900000,
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Research output' }],
  basicConfig: [
    {
      key: 'topic',
      label: 'Topic',
      type: 'template-textarea',
      placeholder: 'What is the impact of …',
      description: 'Topic to research deeply. Supports {{input.*}} / {{item.*}} placeholders.',
      section: 'QUERY',
    },
    {
      key: 'goals',
      label: 'Goals',
      type: 'template-textarea',
      placeholder: 'Understand key players, risks, opportunities',
      description: 'Optional: specific angles or questions. One per line.',
      section: 'QUERY',
    },
    {
      key: 'depth',
      label: 'Depth',
      type: 'dropdown',
      options: [
        { value: 'instant', label: 'Instant — model knowledge, no sources' },
        { value: 'scan', label: 'Scan — one search round, cited (~90s)' },
        { value: 'brief', label: 'Brief — sources + facts (under 2 min)' },
        { value: 'investigation', label: 'Investigation — full engine (20 min+)' },
      ],
      section: 'QUERY',
    },
    {
      key: 'maxWaitMs',
      label: 'Max wait (ms)',
      type: 'number',
      description: 'Polling deadline before giving up.',
      placeholder: '900000',
      section: 'ADVANCED',
    },
  ],
  llmDescription:
    "Commission a long-running deep-research session and block until it finishes (or maxWaitMs elapses). Outputs { researchEngine: 'deep', researchSessionId, researchStatus, researchReport, sources }. Use for thorough investigations where you want a multi-paragraph synthesis with citations — costs minutes of wall-clock time and several LLM calls. For a fast 1-2 paragraph answer use `quick-answer` instead. Pair with a `research-result` display node downstream if you want the canvas to render the report nicely. Templates allowed in topic/goals (e.g. {{input.title}}).",
  llmExamples: [
    { topic: '{{input.title}}', depth: 'brief' },
    { topic: 'Latest advances in solid-state batteries 2026', goals: 'Players, technical readiness, commercialisation timelines', depth: 'investigation' },
  ],
};
