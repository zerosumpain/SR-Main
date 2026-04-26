import type { NodeDefinition } from '../types';

export const blogDef: NodeDefinition = {
  type: 'blog',
  label: 'Blog (legacy)',
  category: 'integration',
  hidden: true,
  description: 'Legacy multi-mode node. Replaced by `blog-list`, `blog-get`, `blog-create`, `blog-update`. Existing canvases keep running.',
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
