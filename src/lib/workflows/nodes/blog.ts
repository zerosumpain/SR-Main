import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { interpolateTemplate } from './template';

export { blogDef } from './blog.def';

export const blogExecutor: NodeExecutor = {
  type: 'blog',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = config.operation as string | undefined;
    if (!operation) {
      return { output: { success: false, error: 'No operation configured' } };
    }

    switch (operation) {
      case 'list': {
        const result = await executeSiteTool('site_blog_list', {});
        return { output: result };
      }

      case 'get': {
        const postId = interpolateTemplate((config.postId as string) || '', input);
        if (!postId) return { output: { success: false, error: 'No postId configured' } };
        const result = await executeSiteTool('site_blog_get', { postId });
        return { output: result };
      }

      case 'create': {
        const title = interpolateTemplate((config.title as string) || '', input);
        const content = interpolateTemplate((config.content as string) || '', input);
        if (!title) return { output: { success: false, error: 'Title is required for create' } };
        const args: Record<string, unknown> = { title, content };
        if (config.status) args.status = config.status;
        if (config.tags) args.tags = config.tags;
        const result = await executeSiteTool('site_blog_create', args);
        return { output: result };
      }

      case 'update': {
        const postId = interpolateTemplate((config.postId as string) || '', input);
        if (!postId) return { output: { success: false, error: 'No postId configured for update' } };
        const args: Record<string, unknown> = { postId };
        if (config.title) args.title = interpolateTemplate((config.title as string), input);
        if (config.content) args.content = interpolateTemplate((config.content as string), input);
        if (config.status) args.status = config.status;
        if (config.tags) args.tags = config.tags;
        const result = await executeSiteTool('site_blog_update', args);
        return { output: result };
      }

      default:
        return { output: { success: false, error: `Unknown operation: ${operation}` } };
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

