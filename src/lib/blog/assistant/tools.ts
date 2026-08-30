import { randomUUID } from 'node:crypto';
import type { Proposal, MetaField } from './proposal';
import { segmentBody, getSentence } from './segment';

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
  toolDef(
    'suggest_sentence_rewrite',
    'Propose a rewrite for ONE specific sentence in the post body. The body is shown to you with [paragraphIdx.sentenceIdx] markers (e.g. [0.0], [1.2]). Pick a sentence by its indices and provide the full replacement sentence. The server resolves the original text from the indices — you never specify text boundaries.',
    {
      paragraphIdx: { type: 'number', description: 'Zero-based paragraph number from the [p.s] markers.' },
      sentenceIdx: { type: 'number', description: 'Zero-based sentence number within that paragraph.' },
      newText: { type: 'string', description: 'The full replacement sentence. Plain prose, no HTML.' },
      reason: { type: 'string', description: 'One short sentence; shown as a tooltip on the suggestion.' },
    },
    ['paragraphIdx', 'sentenceIdx', 'newText', 'reason'],
  ),
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

/** Exported because the autopilot pass builds the same proposal shape without
 *  going through the tool loop. One factory, so the two paths cannot drift. */
export function proseProposal(original: string, suggested: string, from: number, to: number, reason?: string): Proposal {
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

    case 'suggest_sentence_rewrite': {
      const pIdx = Number(args.paragraphIdx);
      const sIdx = Number(args.sentenceIdx);
      const newText = String(args.newText ?? '').trim();
      if (!Number.isFinite(pIdx) || !Number.isFinite(sIdx)) {
        return { ok: false, error: 'paragraphIdx and sentenceIdx must be numbers.' };
      }
      if (!newText) return { ok: false, error: 'newText is empty.' };

      // Resolve the indices to the actual sentence text. The LLM never
      // chooses character boundaries — segmentBody picks them deterministically,
      // so accepts can never be off by a few chars.
      const segmented = segmentBody(snapshot.content);
      const original = getSentence(segmented, pIdx, sIdx);
      if (!original) {
        return { ok: false, error: `no sentence at [${pIdx}.${sIdx}].` };
      }

      // Anchor against the body's plain-text view (used by the runner's
      // prompt and matches the editor's textContent shape).
      const stripTags = (s: string) => s.replace(/<\/?[^>]+>/g, '');
      const collapse = (s: string) => s.replace(/\s+/g, ' ');
      const haystack = collapse(stripTags(snapshot.content));
      const needle = collapse(original).trim();
      const from = haystack.indexOf(needle);
      if (from < 0) {
        return { ok: false, error: `sentence at [${pIdx}.${sIdx}] no longer present in body.` };
      }
      const to = from + needle.length;

      // Strip stray markup from newText (the LLM occasionally wraps it in
      // tags) but DON'T collapse whitespace — preserve the user's intended
      // spacing within the rewritten sentence.
      const cleanedNew = stripTags(newText).trim();
      return { ok: true, proposal: proseProposal(needle, cleanedNew, from, to, reason) };
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
