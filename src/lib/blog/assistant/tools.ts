import { randomUUID } from 'node:crypto';
import type { Proposal, MetaField } from './proposal';

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
};

export type ToolResult =
  | { ok: true; proposal: Proposal }
  | { ok: true; snapshot: PostSnapshot }
  | { ok: false; error: string };

export const toolDefinitions = [
  toolDef('update_title', 'Propose a new post title.', { title: { type: 'string' } }, ['title']),
  toolDef('update_excerpt', 'Propose a new excerpt.', { excerpt: { type: 'string' } }, ['excerpt']),
  toolDef('update_slug', 'Propose a new URL slug (kebab-case).', { slug: { type: 'string' } }, ['slug']),
  toolDef('update_tags', 'Propose a new full tag list.', {
    tags: { type: 'array', items: { type: 'string' } },
  }, ['tags']),
  toolDef('set_status', 'Propose publish/unpublish.', {
    status: { type: 'string', enum: ['draft', 'published'] },
  }, ['status']),
  toolDef('set_cover_alt', 'Propose alt text for the cover image.', {
    alt: { type: 'string' },
  }, ['alt']),
  toolDef('replace_content', 'Propose replacing the entire post body.', {
    content: { type: 'string' },
  }, ['content']),
  toolDef('patch_content', 'Propose a substring replacement in the post body. Errors if find is missing or non-unique.', {
    find: { type: 'string' },
    replace: { type: 'string' },
    reason: { type: 'string', description: 'one short sentence; shown as a tooltip on the suggestion' },
  }, ['find', 'replace']),
  toolDef('read_post', 'Return the current post snapshot. Use when you need to inspect more than what is in the system prompt.', {}, []),
];

function toolDef(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return {
    type: 'function' as const,
    function: { name, description, parameters: { type: 'object', properties, required } },
  };
}

function metaProposal(field: MetaField, currentValue: unknown, suggestedValue: unknown, reason?: string): Proposal {
  return {
    id: randomUUID(), kind: 'meta', field,
    currentValue, suggestedValue, reason, status: 'pending',
  };
}

function proseProposal(original: string, suggested: string, from: number, to: number, reason?: string): Proposal {
  return {
    id: randomUUID(), kind: 'prose',
    original, suggested, anchor: { from, to }, reason, status: 'pending',
  };
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { snapshot } = ctx;
  const reason = typeof args.reason === 'string' ? args.reason : undefined;

  switch (name) {
    case 'update_title':
      return { ok: true, proposal: metaProposal('title', snapshot.title, String(args.title ?? ''), reason) };

    case 'update_excerpt':
      return { ok: true, proposal: metaProposal('excerpt', snapshot.excerpt, String(args.excerpt ?? ''), reason) };

    case 'update_slug':
      return { ok: true, proposal: metaProposal('slug', snapshot.slug, String(args.slug ?? ''), reason) };

    case 'update_tags': {
      const tags = (args.tags as unknown[] | undefined ?? []).map((t) => String(t));
      return { ok: true, proposal: metaProposal('tags', snapshot.tags, tags, reason) };
    }

    case 'set_status':
      return { ok: true, proposal: metaProposal('status', snapshot.status, args.status === 'published' ? 'published' : 'draft', reason) };

    case 'set_cover_alt':
      return { ok: true, proposal: metaProposal('cover_alt', snapshot.coverImageAlt, String(args.alt ?? ''), reason) };

    case 'replace_content':
      return {
        ok: true,
        proposal: proseProposal(snapshot.content, String(args.content ?? ''), 0, snapshot.content.length, reason),
      };

    case 'patch_content': {
      const findRaw = String(args.find ?? '');
      const replaceRaw = String(args.replace ?? '');
      if (!findRaw) return { ok: false, error: 'find string is empty.' };

      // The LLM is shown the post body as HTML. Its `find` argument frequently
      // includes tag fragments (<s>, </p><p>, etc.) that exist in the HTML
      // string but not in the editor's textContent — so any anchoring against
      // the live editor fails. Strip HTML tags from both sides and match
      // against a tag-stripped haystack so patches always anchor to plain
      // prose. Whitespace runs are collapsed to single spaces on both sides
      // so the LLM doesn't have to guess about indentation between blocks.
      const stripTags = (s: string) => s.replace(/<\/?[^>]+>/g, '');
      const collapse = (s: string) => s.replace(/\s+/g, ' ');
      const find = collapse(stripTags(findRaw)).trim();
      let replace = collapse(stripTags(replaceRaw));
      const haystack = collapse(stripTags(snapshot.content));

      if (!find) return { ok: false, error: 'find string is empty after stripping tags.' };
      const occurrences = haystack.split(find).length - 1;
      if (occurrences === 0) return { ok: false, error: 'find string not found in content.' };
      if (occurrences > 1) return { ok: false, error: `find string not unique (${occurrences} matches).` };

      // Defensively preserve boundary whitespace from `find` if the LLM
      // dropped it on `replace`. Only auto-fix when `replace` is non-empty.
      if (replace.length > 0) {
        const leading = find.match(/^\s+/)?.[0] ?? '';
        const trailing = find.match(/\s+$/)?.[0] ?? '';
        if (leading && !/^\s/.test(replace)) replace = leading + replace;
        if (trailing && !/\s$/.test(replace)) replace = replace + trailing;
      }

      const from = haystack.indexOf(find);
      const to = from + find.length;
      return { ok: true, proposal: proseProposal(find, replace, from, to, reason) };
    }

    case 'read_post':
      return { ok: true, snapshot };

    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

export function isProposalResult(r: ToolResult): r is { ok: true; proposal: Proposal } {
  return r.ok && 'proposal' in r;
}
