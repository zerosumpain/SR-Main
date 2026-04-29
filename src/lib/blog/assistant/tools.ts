import {
  updatePostFields,
  replaceTags,
  isSlugTaken,
} from '$lib/blog';
import type { UndoStore } from './undo-store';

export type PostSnapshot = {
  id: number;
  title: string;
  excerpt: string;
  slug: string;
  content: string;
  contentFormat: 'html' | 'markdown';
  status: 'draft' | 'published';
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  publishedAt: Date | null;
  previewToken: string | null;
  tags: string[];
};

export type ToolContext = {
  postId: number;
  snapshot: PostSnapshot;
  undoStore: UndoStore;
};

export type ToolResult =
  | { ok: true; undoToken?: string; result?: unknown }
  | { ok: false; error: string };

export const toolDefinitions = [
  {
    type: 'function' as const,
    function: {
      name: 'update_title',
      description: 'Set the post title.',
      parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_excerpt',
      description: 'Set the short excerpt shown in lists and previews.',
      parameters: { type: 'object', properties: { excerpt: { type: 'string' } }, required: ['excerpt'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_slug',
      description: 'Set the URL slug (kebab-case). Errors if already taken.',
      parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_tags',
      description: 'Replace the full tag list.',
      parameters: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } }, required: ['tags'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'replace_content',
      description: 'Replace the entire post body.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          format: { type: 'string', enum: ['html', 'markdown'] },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'patch_content',
      description: 'Find/replace a single substring inside the post body. Errors if find is missing or non-unique.',
      parameters: {
        type: 'object',
        properties: { find: { type: 'string' }, replace: { type: 'string' } },
        required: ['find', 'replace'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_status',
      description: 'Publish or unpublish the post.',
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['draft', 'published'] } },
        required: ['status'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_cover_alt',
      description: 'Set the alt text for the cover image.',
      parameters: { type: 'object', properties: { alt: { type: 'string' } }, required: ['alt'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_post',
      description: 'Return the current post payload (no write).',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { postId, snapshot, undoStore } = ctx;

  switch (name) {
    case 'read_post':
      return { ok: true, result: snapshot };

    case 'update_title': {
      const title = String(args.title ?? '');
      await updatePostFields(postId, { title });
      const undoToken = undoStore.put({ postId, field: 'title', previousValue: snapshot.title });
      ctx.snapshot.title = title;
      return { ok: true, undoToken, result: { title } };
    }

    case 'update_excerpt': {
      const excerpt = String(args.excerpt ?? '');
      await updatePostFields(postId, { excerpt });
      const undoToken = undoStore.put({ postId, field: 'excerpt', previousValue: snapshot.excerpt });
      ctx.snapshot.excerpt = excerpt;
      return { ok: true, undoToken, result: { excerpt } };
    }

    case 'update_slug': {
      const slug = String(args.slug ?? '');
      if (await isSlugTaken(slug, postId)) {
        return { ok: false, error: `Slug "${slug}" is already in use.` };
      }
      await updatePostFields(postId, { slug });
      const undoToken = undoStore.put({ postId, field: 'slug', previousValue: snapshot.slug });
      ctx.snapshot.slug = slug;
      return { ok: true, undoToken, result: { slug } };
    }

    case 'update_tags': {
      const tags = (args.tags as unknown[] | undefined ?? []).map((t) => String(t));
      await replaceTags(postId, tags);
      const undoToken = undoStore.put({ postId, field: 'tags', previousValue: snapshot.tags });
      ctx.snapshot.tags = tags;
      return { ok: true, undoToken, result: { tags } };
    }

    case 'replace_content': {
      const content = String(args.content ?? '');
      const format = (args.format as 'html' | 'markdown' | undefined) ?? snapshot.contentFormat;
      await updatePostFields(postId, { content, contentFormat: format });
      const undoToken = undoStore.put({
        postId,
        field: 'content',
        previousValue: { content: snapshot.content, contentFormat: snapshot.contentFormat },
      });
      ctx.snapshot.content = content;
      ctx.snapshot.contentFormat = format;
      return { ok: true, undoToken, result: { content, format } };
    }

    case 'patch_content': {
      const find = String(args.find ?? '');
      const replace = String(args.replace ?? '');
      if (!find) return { ok: false, error: 'find string is empty.' };
      const occurrences = snapshot.content.split(find).length - 1;
      if (occurrences === 0) return { ok: false, error: `find string not found in content.` };
      if (occurrences > 1) return { ok: false, error: `find string not unique (${occurrences} matches).` };
      const next = snapshot.content.replace(find, replace);
      await updatePostFields(postId, { content: next });
      const undoToken = undoStore.put({ postId, field: 'content', previousValue: snapshot.content });
      ctx.snapshot.content = next;
      return { ok: true, undoToken, result: { content: next } };
    }

    case 'set_status': {
      const status = args.status === 'published' ? 'published' : 'draft';
      const fields: Parameters<typeof updatePostFields>[1] = { status };
      if (status === 'published' && !snapshot.publishedAt) {
        fields.publishedAt = new Date();
      }
      await updatePostFields(postId, fields);
      const undoToken = undoStore.put({
        postId,
        field: 'status',
        previousValue: { status: snapshot.status, publishedAt: snapshot.publishedAt },
      });
      ctx.snapshot.status = status;
      if (fields.publishedAt) ctx.snapshot.publishedAt = fields.publishedAt;
      return { ok: true, undoToken, result: { status } };
    }

    case 'set_cover_alt': {
      const alt = String(args.alt ?? '');
      await updatePostFields(postId, { coverImageAlt: alt });
      const undoToken = undoStore.put({ postId, field: 'coverImageAlt', previousValue: snapshot.coverImageAlt });
      ctx.snapshot.coverImageAlt = alt;
      return { ok: true, undoToken, result: { alt } };
    }

    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
