import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { interpolateTemplate } from './template';

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

export const blogDef: NodeDefinition = {
  type: 'blog',
  label: 'Blog',
  category: 'integration',
  description: 'Manage blog posts: list, get, create, and update.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'list | get | create | update' },
      postId: { type: 'string', description: 'Post ID for get/update. Supports templates.' },
      title: { type: 'string', description: 'Post title. Supports templates.' },
      content: { type: 'string', description: 'Post content (HTML). Supports templates.' },
      status: { type: 'string', description: 'Post status (draft | published)' },
      tags: { type: 'string', description: 'Comma-separated tags' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'list' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation', label: 'Action', type: 'dropdown',
      description: 'What to do with blog posts',
      options: [
        { value: 'list', label: 'List Posts' },
        { value: 'get', label: 'Get Post' },
        { value: 'create', label: 'Create Post' },
        { value: 'update', label: 'Update Post' },
      ],
    },
    {
      key: 'postId', label: 'Post ID', type: 'template-textarea',
      placeholder: '{{input.id}}',
      description: 'ID of the post to fetch or update.',
      visibleWhen: { key: 'operation', in: ['get', 'update'] },
    },
    {
      key: 'title', label: 'Title', type: 'template-textarea',
      placeholder: 'My Blog Post',
      description: 'Post title. Supports {{input.field}} templates.',
      visibleWhen: { key: 'operation', in: ['create', 'update'] },
    },
    {
      key: 'content', label: 'Content', type: 'template-textarea',
      placeholder: '<p>Post content here...</p>',
      description: 'Post body as HTML. Supports {{input.field}} templates.',
      visibleWhen: { key: 'operation', in: ['create', 'update'] },
    },
    {
      key: 'status', label: 'Status', type: 'dropdown',
      description: 'Publish state of the post',
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'published', label: 'Published' },
      ],
      visibleWhen: { key: 'operation', in: ['create', 'update'] },
    },
    {
      key: 'tags', label: 'Tags', type: 'text',
      placeholder: 'tech, ai, personal',
      description: 'Comma-separated list of tags.',
      visibleWhen: { key: 'operation', in: ['create', 'update'] },
    },
  ],
  llmDescription: `Manage blog posts on the site. Supports four operations:

1. **list** — List all blog posts (most recent first, up to 50)
2. **get** — Get a single post by ID
3. **create** — Create a new blog post. Requires title; content, status, and tags are optional.
4. **update** — Update an existing post by ID. Pass only the fields to change.

IMPORTANT: Downstream nodes access this node's result as \`input.success\`, \`input.data\`, \`input.error\` (the upstream output is merged directly into the downstream input).

All text fields support \`{{input.field}}\` template interpolation.`,
  llmExamples: [
    { operation: 'list' },
    { operation: 'create', title: 'Weekly Update', content: '<p>This week...</p>', status: 'draft', tags: 'weekly, update' },
    { operation: 'update', postId: '{{input.id}}', status: 'published' },
  ],
};
