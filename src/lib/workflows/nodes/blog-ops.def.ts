import type { NodeDefinition } from '../types';

export const blogListDef: NodeDefinition = {
  type: 'blog-list',
  label: 'Blog: list posts',
  category: 'integration',
  description: 'List the most recent blog posts (up to 50).',
  configSchema: { type: 'object', properties: {} },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Posts' }],
  basicConfig: [],
  llmDescription: 'List blog posts. No config. Output: { success, data: { posts: [...] } }.',
  llmExamples: [{}],
};

export const blogGetDef: NodeDefinition = {
  type: 'blog-get',
  label: 'Blog: get post',
  category: 'integration',
  description: 'Fetch a single blog post by ID.',
  configSchema: {
    type: 'object',
    properties: {
      postId: { type: 'string', description: 'Post ID. Supports {{input.field}}.' },
    },
    required: ['postId'],
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Post' }],
  basicConfig: [
    { key: 'postId', label: 'Post ID', type: 'template-textarea', placeholder: '{{input.id}}', description: 'Supports {{input.field}}.' },
  ],
  llmDescription: 'Get one post by ID. Output: { success, data: { post } }.',
  llmExamples: [{ postId: '{{input.id}}' }],
};

export const blogCreateDef: NodeDefinition = {
  type: 'blog-create',
  label: 'Blog: create post',
  category: 'integration',
  description: 'Create a new blog post. Supports template interpolation in title and content.',
  configSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Post title. Supports {{input.field}}.' },
      content: { type: 'string', description: 'Post body as HTML. Supports {{input.field}}.' },
      status: { type: 'string', enum: ['draft', 'published'], description: 'Defaults to draft.' },
      tags: { type: 'string', description: 'Comma-separated tags.' },
    },
    required: ['title'],
  },
  defaultConfig: { status: 'draft' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'title', label: 'Title', type: 'template-textarea', placeholder: 'Weekly Update', description: 'Supports {{input.field}}.' },
    { key: 'content', label: 'Content (HTML)', type: 'template-textarea', placeholder: '<p>This week…</p>', description: 'Supports {{input.field}}.' },
    {
      key: 'status', label: 'Status', type: 'dropdown', description: 'Defaults to draft.',
      options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }],
    },
    { key: 'tags', label: 'Tags', type: 'text', placeholder: 'tech, ai, personal', description: 'Comma-separated.' },
  ],
  llmDescription: 'Create a blog post. Title required; everything else optional. Output: { success, data: { post } }.',
  llmExamples: [
    { title: 'Weekly Update', content: '<p>This week…</p>', status: 'draft', tags: 'weekly, update' },
    { title: '{{input.headline}}', content: '{{input.body}}' },
  ],
};

export const blogUpdateDef: NodeDefinition = {
  type: 'blog-update',
  label: 'Blog: update post',
  category: 'integration',
  description: 'Update an existing blog post. Pass only the fields you want to change.',
  configSchema: {
    type: 'object',
    properties: {
      postId: { type: 'string', description: 'Post ID. Supports {{input.field}}.' },
      title: { type: 'string', description: 'New title. Omit to leave unchanged.' },
      content: { type: 'string', description: 'New content (HTML). Omit to leave unchanged.' },
      status: { type: 'string', enum: ['draft', 'published'], description: 'Omit to leave unchanged.' },
      tags: { type: 'string', description: 'New tags. Omit to leave unchanged.' },
    },
    required: ['postId'],
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'postId', label: 'Post ID', type: 'template-textarea', placeholder: '{{input.id}}', description: 'Supports {{input.field}}.' },
    { key: 'title', label: 'Title', type: 'template-textarea', description: 'Optional. Supports {{input.field}}.' },
    { key: 'content', label: 'Content (HTML)', type: 'template-textarea', description: 'Optional. Supports {{input.field}}.' },
    {
      key: 'status', label: 'Status', type: 'dropdown', description: 'Optional.',
      options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }],
    },
    { key: 'tags', label: 'Tags', type: 'text', description: 'Optional. Comma-separated.' },
  ],
  llmDescription: 'Update an existing post. Only postId is required; pass only the fields you want to change. To publish a draft: { postId, status: "published" }.',
  llmExamples: [
    { postId: '{{input.id}}', status: 'published' },
    { postId: '{{input.post.id}}', title: '{{input.headline}}', content: '{{input.body}}' },
  ],
};
