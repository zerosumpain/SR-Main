import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { interpolateTemplate } from './template';

export { blogDef } from './blog.def';

export const blogExecutor: NodeExecutor = {
  type: 'blog',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = config.operation as string | undefined;
    if (!operation) {
      return { output: { success: false, error: 'No operation configured' }, rowCount: 1 };
    }

    switch (operation) {
      case 'list': {
        const result = await executeSiteTool('site_blog_list', {});
        return { output: result, rowCount: 1 };
      }

      case 'get': {
        const postId = interpolateTemplate((config.postId as string) || '', input);
        if (!postId) return { output: { success: false, error: 'No postId configured' }, rowCount: 1 };
        const result = await executeSiteTool('site_blog_get', { postId });
        return { output: result, rowCount: 1 };
      }

      case 'create': {
        const title = interpolateTemplate((config.title as string) || '', input);
        const content = interpolateTemplate((config.content as string) || '', input);
        if (!title) return { output: { success: false, error: 'Title is required for create' }, rowCount: 1 };
        if (context.dryRun) {
          return {
            output: {
              simulated: true,
              would_publish: {
                title,
                slug: (config.slug as string | undefined) ?? null,
                status: (config.status as string | undefined) ?? 'draft',
              },
            },
            rowCount: 1,
            logs: [`[dry-run] would create blog post "${title}" (status: ${config.status ?? 'draft'})`],
          };
        }
        const args: Record<string, unknown> = { title, content };
        if (config.status) args.status = config.status;
        if (config.tags) args.tags = config.tags;
        const result = await executeSiteTool('site_blog_create', args);
        return { output: result, rowCount: 1 };
      }

      case 'update': {
        const postId = interpolateTemplate((config.postId as string) || '', input);
        if (!postId) return { output: { success: false, error: 'No postId configured for update' }, rowCount: 1 };
        const interpolatedTitle = config.title ? interpolateTemplate((config.title as string), input) : undefined;
        if (context.dryRun) {
          return {
            output: {
              simulated: true,
              would_publish: {
                title: interpolatedTitle ?? `(unchanged, postId=${postId})`,
                slug: (config.slug as string | undefined) ?? null,
                status: (config.status as string | undefined) ?? null,
              },
            },
            rowCount: 1,
            logs: [`[dry-run] would update blog post ${postId}${interpolatedTitle ? ` -> "${interpolatedTitle}"` : ''}`],
          };
        }
        const args: Record<string, unknown> = { postId };
        if (interpolatedTitle !== undefined) args.title = interpolatedTitle;
        if (config.content) args.content = interpolateTemplate((config.content as string), input);
        if (config.status) args.status = config.status;
        if (config.tags) args.tags = config.tags;
        const result = await executeSiteTool('site_blog_update', args);
        return { output: result, rowCount: 1 };
      }

      default:
        return { output: { success: false, error: `Unknown operation: ${operation}` }, rowCount: 1 };
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation in config fields' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'object' },
        error: { type: 'string' },
      },
    };
  },
};

