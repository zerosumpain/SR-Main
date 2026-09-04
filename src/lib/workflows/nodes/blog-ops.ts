// Per-operation blog nodes — split the multi-mode `blog` node so each
// operation has only the fields it actually needs.
import type { NodeExecutor, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { interpolateTemplate } from './template';
import { blogListDef, blogGetDef, blogCreateDef, blogUpdateDef } from './blog-ops.def';
export { blogListDef, blogGetDef, blogCreateDef, blogUpdateDef } from './blog-ops.def';

const RESULT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' } as const,
    data: { type: 'object' } as const,
    error: { type: 'string' } as const,
  } as Record<string, JsonSchema>,
};

// ───────────────────── blog-list ─────────────────────

export const blogListExecutor: NodeExecutor = {
  type: 'blog-list',
  async execute(_input, _config, _ctx: ExecutionContext): Promise<NodeResult> {
    const result = await executeSiteTool('site_blog_list', {});
    return { output: result, rowCount: 1 };
  },
  getInputSchema(): JsonSchema { return { type: 'object', description: 'No input required.' }; },
  getOutputSchema(): JsonSchema { return RESULT_SCHEMA; },
};


// ───────────────────── blog-get ─────────────────────

export const blogGetExecutor: NodeExecutor = {
  type: 'blog-get',
  async execute(input, config, _ctx: ExecutionContext): Promise<NodeResult> {
    const postId = interpolateTemplate((config.postId as string) || '', input).trim();
    if (!postId) throw new Error('blog-get: postId is required');
    const result = await executeSiteTool('site_blog_get', { postId });
    return { output: result, rowCount: 1 };
  },
  getInputSchema(): JsonSchema { return { type: 'object', description: 'Used for template interpolation of postId.' }; },
  getOutputSchema(): JsonSchema { return RESULT_SCHEMA; },
};


// ───────────────────── blog-create ─────────────────────

export const blogCreateExecutor: NodeExecutor = {
  type: 'blog-create',
  async execute(input, config, ctx: ExecutionContext): Promise<NodeResult> {
    const title = interpolateTemplate((config.title as string) || '', input).trim();
    if (!title) throw new Error('blog-create: title is required');
    const content = interpolateTemplate((config.content as string) || '', input);
    const args: Record<string, unknown> = { title, content };
    if (config.status) args.status = config.status;
    if (config.tags) args.tags = config.tags;
    if (ctx.dryRun) {
      return { output: { success: true, dryRun: true, data: { simulated: true, action: 'create', title } }, rowCount: 1 };
    }
    const result = await executeSiteTool('site_blog_create', args);
    return { output: result, rowCount: 1 };
  },
  getInputSchema(): JsonSchema { return { type: 'object', description: 'Used for template interpolation in title/content.' }; },
  getOutputSchema(): JsonSchema { return RESULT_SCHEMA; },
};


// ───────────────────── blog-update ─────────────────────

export const blogUpdateExecutor: NodeExecutor = {
  type: 'blog-update',
  async execute(input, config, ctx: ExecutionContext): Promise<NodeResult> {
    const postId = interpolateTemplate((config.postId as string) || '', input).trim();
    if (!postId) throw new Error('blog-update: postId is required');
    const args: Record<string, unknown> = { postId };
    if (config.title) args.title = interpolateTemplate((config.title as string), input);
    if (config.content) args.content = interpolateTemplate((config.content as string), input);
    if (config.status) args.status = config.status;
    if (config.tags) args.tags = config.tags;
    if (ctx.dryRun) {
      return { output: { success: true, dryRun: true, data: { simulated: true, action: 'update', postId } }, rowCount: 1 };
    }
    const result = await executeSiteTool('site_blog_update', args);
    return { output: result, rowCount: 1 };
  },
  getInputSchema(): JsonSchema { return { type: 'object', description: 'Used for template interpolation.' }; },
  getOutputSchema(): JsonSchema { return RESULT_SCHEMA; },
};
