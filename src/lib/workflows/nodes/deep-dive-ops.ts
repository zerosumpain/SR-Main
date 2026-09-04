// Per-operation deep-dive nodes — split the multi-mode `deep-dive` node
// so each step in a research pipeline is its own primitive.
import type { NodeExecutor, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { interpolateTemplate } from './template';
import { deepDiveStartDef, deepDiveStatusDef, deepDiveReportDef, deepDiveListDef, deepDiveControlDef } from './deep-dive-ops.def';
export { deepDiveStartDef, deepDiveStatusDef, deepDiveReportDef, deepDiveListDef, deepDiveControlDef } from './deep-dive-ops.def';

const RESULT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' } as const,
    data: { type: 'object' } as const,
    error: { type: 'string' } as const,
  } as Record<string, JsonSchema>,
};

// ───────────────────── deep-dive-start ─────────────────────

export const deepDiveStartExecutor: NodeExecutor = {
  type: 'deep-dive-start',
  async execute(input, config, _ctx: ExecutionContext): Promise<NodeResult> {
    const topic = interpolateTemplate((config.topic as string) || '', input).trim();
    if (!topic) throw new Error('deep-dive-start: topic is required');
    const goals = interpolateTemplate((config.goals as string) || '', input);
    const args: Record<string, unknown> = { topic };
    if (goals) args.goals = goals;
    if (config.depth) args.depth = config.depth;
    const result = await executeSiteTool('research_start', args);
    return { output: result, rowCount: 1 };
  },
  getInputSchema(): JsonSchema { return { type: 'object', description: 'Used for template interpolation.' }; },
  getOutputSchema(): JsonSchema { return RESULT_SCHEMA; },
};


// ───────────────────── deep-dive-status ─────────────────────

export const deepDiveStatusExecutor: NodeExecutor = {
  type: 'deep-dive-status',
  async execute(input, config, _ctx: ExecutionContext): Promise<NodeResult> {
    const sessionId = interpolateTemplate((config.sessionId as string) || '', input).trim();
    if (!sessionId) throw new Error('deep-dive-status: sessionId is required');
    const result = await executeSiteTool('research_status', { id: sessionId });
    return { output: result, rowCount: 1 };
  },
  getInputSchema(): JsonSchema { return { type: 'object', description: 'Used for template interpolation.' }; },
  getOutputSchema(): JsonSchema { return RESULT_SCHEMA; },
};


// ───────────────────── deep-dive-report ─────────────────────

export const deepDiveReportExecutor: NodeExecutor = {
  type: 'deep-dive-report',
  async execute(input, config, _ctx: ExecutionContext): Promise<NodeResult> {
    const sessionId = interpolateTemplate((config.sessionId as string) || '', input).trim();
    if (!sessionId) throw new Error('deep-dive-report: sessionId is required');
    const result = await executeSiteTool('research_get_report', { id: sessionId });
    return { output: result, rowCount: 1 };
  },
  getInputSchema(): JsonSchema { return { type: 'object', description: 'Used for template interpolation.' }; },
  getOutputSchema(): JsonSchema { return RESULT_SCHEMA; },
};


// ───────────────────── deep-dive-list ─────────────────────

export const deepDiveListExecutor: NodeExecutor = {
  type: 'deep-dive-list',
  async execute(_input, _config, _ctx: ExecutionContext): Promise<NodeResult> {
    const result = await executeSiteTool('research_list', {});
    return { output: result, rowCount: 1 };
  },
  getInputSchema(): JsonSchema { return { type: 'object', description: 'No input required.' }; },
  getOutputSchema(): JsonSchema { return RESULT_SCHEMA; },
};


// ───────────────────── deep-dive-control ─────────────────────

export const deepDiveControlExecutor: NodeExecutor = {
  type: 'deep-dive-control',
  async execute(input, config, _ctx: ExecutionContext): Promise<NodeResult> {
    const sessionId = interpolateTemplate((config.sessionId as string) || '', input).trim();
    const action = (config.action as string) || '';
    if (!sessionId) throw new Error('deep-dive-control: sessionId is required');
    if (!action) throw new Error('deep-dive-control: action is required (pause | resume | cancel)');
    const result = await executeSiteTool('research_control', { id: sessionId, action });
    return { output: result, rowCount: 1 };
  },
  getInputSchema(): JsonSchema { return { type: 'object', description: 'Used for template interpolation.' }; },
  getOutputSchema(): JsonSchema { return RESULT_SCHEMA; },
};
