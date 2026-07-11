// sr. decks — build a presentation from an explicit spec. The deck twin of
// workflow_build_from_spec: the LLM designs the deck IN CHAT first (outline,
// per-slide blocks), gets a yes, then persists it here. Zero LLM calls inside
// the tool — Hermes is the author, this is the persister.
// Spec: docs/superpowers/specs/2026-07-11-decks-presentation-capability.md

import { register } from '../registry-internal';
import { db } from '$lib/db';
import { deckSlides, decks, type DeckSlide } from '$lib/db/schema';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { slugify } from '$lib/canvas/slug';
import { createShare } from '$lib/decks/shares';
import { isLayout, layoutDocsForLLM } from '$lib/presentation/layouts';
import { BLOCK_DOCS, validateBlocks } from '$lib/presentation/registry';
import { scenarioById } from '$lib/sim/federation/scenarios';

interface SlideSpec {
  title?: string;
  layout?: string;
  blocks: unknown[];
  notes?: string;
  children?: SlideSpec[];
}

function shortSlug(src: string): string {
  const base = slugify(src || 'deck');
  if (!base) return 'deck';
  if (base.length <= 32) return base;
  const words = base.split('-');
  let out = '';
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > 32) break;
    out = next;
  }
  return out || base.slice(0, 32);
}

async function pickUniqueSlug(seed: string): Promise<string> {
  const baseSlug = shortSlug(seed);
  let slug = baseSlug;
  let attempt = 1;
  while (attempt < 50) {
    const [existing] = await db.select({ id: decks.id }).from(decks).where(eq(decks.slug, slug));
    if (!existing) break;
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }
  return slug;
}

/** Validate one slide (and its children) — returns path-labelled issues. */
function validateSlide(slide: SlideSpec, path: string, depth: number): string[] {
  const issues: string[] = [];
  if (slide.layout && !isLayout(slide.layout)) {
    issues.push(`${path}: unknown layout "${slide.layout}" — see the layout list in this tool's description`);
  }
  if (!Array.isArray(slide.blocks) || slide.blocks.length === 0) {
    issues.push(`${path}: blocks must be a non-empty array`);
  } else {
    const res = validateBlocks(slide.blocks);
    issues.push(...res.issues.map((i) => `${path}.${i}`));
    for (const b of slide.blocks as { type?: string; embed?: string; config?: { scenario?: string } }[]) {
      if (b?.type === 'embed' && b.embed === 'federation-sim' && b.config?.scenario && !scenarioById(b.config.scenario)) {
        issues.push(`${path}: federation-sim scenario "${b.config.scenario}" does not exist`);
      }
    }
  }
  if (slide.children?.length) {
    if (depth >= 2) {
      issues.push(`${path}: nesting deeper than 2 levels is not presentable — flatten the structure`);
    } else {
      slide.children.forEach((c, i) => issues.push(...validateSlide(c, `${path}.children[${i}]`, depth + 1)));
    }
  }
  return issues;
}

async function insertSlides(deckId: string, slides: SlideSpec[], parentSlideId: string | null): Promise<number> {
  let count = 0;
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const [row] = await db
      .insert(deckSlides)
      .values({
        deckId,
        parentSlideId,
        position: i,
        title: s.title?.slice(0, 120) ?? null,
        layout: isLayout(s.layout) ? s.layout : 'default',
        blocks: s.blocks,
        notes: s.notes ?? null,
      })
      .returning({ id: deckSlides.id });
    count += 1;
    if (s.children?.length) count += await insertSlides(deckId, s.children, row.id);
  }
  return count;
}

function outlineMarkdown(slides: SlideSpec[], indent = ''): string {
  return slides
    .map((s, i) => {
      const types = (s.blocks as { type?: string }[]).map((b) => b.type).join(', ');
      const line = `${indent}${i + 1}. **${s.title ?? 'Untitled'}** — ${types}`;
      return s.children?.length ? `${line}\n${outlineMarkdown(s.children, `${indent}   `)}` : line;
    })
    .join('\n');
}

register({
  name: 'presentation_build_from_spec',
  description:
    'Build a NEW sr. decks presentation (/decks/<slug>) from an EXPLICIT spec — title plus a tree of slides, ' +
    'each slide an ordered list of typed blocks. ' +
    'DESIGN-FIRST WORKFLOW: before calling this tool you MUST have written the deck outline in chat ' +
    '(numbered slides, per-slide block types and key content, which slides nest as a zoom-in sub-deck) ' +
    'and the user must have said yes/build it. Never call this tool with a guess at the design. ' +
    'Slides with `children` become zoomable sub-decks in the player (Enter dives in, Escape rises out). ' +
    `Layouts (pick for impact and vary them for rhythm): ${layoutDocsForLLM()} ` +
    `Block vocabulary: ${Object.entries(BLOCK_DOCS)
      .map(([k, v]) => `${k} — ${v}`)
      .join(' | ')} ` +
    'Draw content from real site material (research_search, file_search, the data-spine study) — decks are ' +
    'editorial, factual, and cite what they claim. ' +
    'Decks are PRIVATE by default; the tool mints a share link and returns it. ' +
    'CRITICAL: paste `data.summaryMarkdown` VERBATIM as your reply when the tool returns. Do NOT rewrite it ' +
    'or construct your own URLs.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Deck title (slugified for the URL).' },
      description: { type: 'string', description: 'One-line description of the deck.' },
      slug: { type: 'string', description: 'Optional explicit URL slug (lowercase-hyphenated). Defaults to the slugified title.' },
      is_public: { type: 'boolean', description: 'Publish publicly at once (default false — private + share link).' },
      slides: {
        type: 'array',
        description:
          'Ordered slides. Each: { title, layout?: default|center|full-bleed, blocks: Block[], notes?, children?: Slide[] }. ' +
          'children = the sub-deck the player zooms into from that slide (one level of nesting; two max).',
        items: { type: 'object' },
      },
    },
    required: ['title', 'slides'],
  },
  category: 'Decks',
  toolset: 'decks',
  handler: async (args, ctx) => {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    const slides = args.slides as SlideSpec[] | undefined;
    if (!title) return { success: false, error: 'title is required' };
    if (!Array.isArray(slides) || slides.length === 0) return { success: false, error: 'slides must be a non-empty array' };
    if (slides.length > 40) return { success: false, error: 'too many top-level slides (max 40) — tighten the story' };

    const issues = slides.flatMap((s, i) => validateSlide(s, `slides[${i}]`, 0));
    if (issues.length) {
      return {
        success: false,
        error: `spec failed validation — fix these and call again:\n- ${issues.join('\n- ')}`,
      };
    }

    const slug = await pickUniqueSlug(typeof args.slug === 'string' && args.slug.trim() ? args.slug : title);
    const baseUrl = (process.env.PUBLIC_SITE_URL || 'https://strangeramblings.com').replace(/\/+$/, '');
    const url = `${baseUrl}/decks/${slug}`;
    ctx?.emit(`Building deck at ${url} …`);

    const [deck] = await db
      .insert(decks)
      .values({
        slug,
        title,
        description: typeof args.description === 'string' ? args.description : null,
        theme: 'editorial',
        isPublic: args.is_public === true,
      })
      .returning({ id: decks.id });

    let slideCount = 0;
    try {
      slideCount = await insertSlides(deck.id, slides, null);
    } catch (err) {
      // Leave nothing half-presentable behind — the deck row cascades the slides.
      await db.delete(decks).where(eq(decks.id, deck.id)).catch(() => {});
      return { success: false, error: `slide insert failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    // Verification: what's persisted must re-validate (same gate the player trusts).
    const persisted = await db.select().from(deckSlides).where(eq(deckSlides.deckId, deck.id));
    const persistIssues = persisted.flatMap((row) => {
      const res = validateBlocks(row.blocks);
      return res.issues.map((i) => `slide "${row.title ?? row.id}": ${i}`);
    });

    const share = await createShare({ deckId: deck.id, createdBy: 'jkai', label: 'built from chat' });
    const shareUrl = `${url}?t=${share.token}`;

    const summaryMarkdown = [
      `**[${title}](${url})** — ${slideCount} slides${args.is_public === true ? ' · public' : ' · private'}`,
      '',
      `Share link (grants view access): ${shareUrl}`,
      '',
      outlineMarkdown(slides),
      '',
      'Play: ← → move · Enter dives into a sub-deck · Escape rises · F fullscreen.',
      ...(persistIssues.length ? ['', '**Needs attention:**', ...persistIssues.map((i) => `- ${i}`)] : []),
    ].join('\n');

    return {
      success: persistIssues.length === 0,
      data: { deckId: deck.id, slug, url, shareUrl, slideCount, summaryMarkdown, verificationIssues: persistIssues },
    };
  },
});

/** Rebuild the nested SlideSpec tree from flat deck_slides rows. */
function rowsToSpecTree(rows: DeckSlide[], parentSlideId: string | null): SlideSpec[] {
  return rows
    .filter((r) => r.parentSlideId === parentSlideId)
    .sort((a, b) => a.position - b.position)
    .map((r) => {
      const children = rowsToSpecTree(rows, r.id);
      const spec: SlideSpec = {
        title: r.title ?? undefined,
        layout: r.layout,
        blocks: r.blocks as unknown[],
        notes: r.notes ?? undefined,
      };
      if (children.length) spec.children = children;
      return spec;
    });
}

register({
  name: 'presentation_list',
  description:
    'List sr. decks presentations (slug, title, visibility, slide count, updated). Use to find a deck before reading or revising it.',
  parameters: { type: 'object', properties: {} },
  category: 'Decks',
  toolset: 'decks',
  handler: async () => {
    const rows = await db
      .select({
        slug: decks.slug,
        title: decks.title,
        description: decks.description,
        isPublic: decks.isPublic,
        updatedAt: decks.updatedAt,
        slideCount: sql<number>`(select count(*) from ${deckSlides} where ${deckSlides.deckId} = ${decks.id})`,
      })
      .from(decks)
      .orderBy(desc(decks.updatedAt));
    return { success: true, data: { decks: rows } };
  },
});

register({
  name: 'presentation_get_spec',
  description:
    'Read an existing sr. deck as the SAME spec shape presentation_update_from_spec accepts — ' +
    '{ title, description, slug, is_public, slides: [{ title, layout, blocks, notes?, children? }] }. ' +
    'This is step 1 of revising a deck: read the spec, apply the user’s requested changes to it, propose ' +
    'the revised outline in chat, and only after a yes call presentation_update_from_spec.',
  parameters: {
    type: 'object',
    properties: { slug: { type: 'string', description: 'Deck slug (see presentation_list).' } },
    required: ['slug'],
  },
  category: 'Decks',
  toolset: 'decks',
  handler: async (args) => {
    const slug = typeof args.slug === 'string' ? args.slug.trim() : '';
    const [deck] = await db.select().from(decks).where(eq(decks.slug, slug));
    if (!deck) return { success: false, error: `no deck with slug "${slug}" — call presentation_list` };
    const rows = await db
      .select()
      .from(deckSlides)
      .where(eq(deckSlides.deckId, deck.id))
      .orderBy(asc(deckSlides.position));
    return {
      success: true,
      data: {
        slug: deck.slug,
        title: deck.title,
        description: deck.description,
        is_public: deck.isPublic,
        theme: deck.theme,
        slides: rowsToSpecTree(rows, null),
      },
    };
  },
});

register({
  name: 'presentation_update_from_spec',
  description:
    'REPLACE the slides of an EXISTING sr. deck with a revised spec (same shape as presentation_build_from_spec). ' +
    'The deck keeps its slug, URL and share links; the slide content is rewritten wholesale. ' +
    'REVISE-FIRST WORKFLOW: you MUST have (1) called presentation_get_spec, (2) applied the user’s requested ' +
    'changes to that spec, (3) shown the revised outline (and what changed) in chat, and (4) received a ' +
    'yes/update it — before calling this. Never call it with a guess. ' +
    'CRITICAL: paste `data.summaryMarkdown` VERBATIM as your reply when the tool returns.',
  parameters: {
    type: 'object',
    properties: {
      slug: { type: 'string', description: 'Slug of the deck to update.' },
      title: { type: 'string', description: 'Optional new title.' },
      description: { type: 'string', description: 'Optional new description.' },
      slides: {
        type: 'array',
        description: 'The COMPLETE revised slide tree (replaces all existing slides).',
        items: { type: 'object' },
      },
    },
    required: ['slug', 'slides'],
  },
  category: 'Decks',
  toolset: 'decks',
  destructive: true, // overwrites existing deck content — confirm before running
  handler: async (args, ctx) => {
    const slug = typeof args.slug === 'string' ? args.slug.trim() : '';
    const slides = args.slides as SlideSpec[] | undefined;
    const [deck] = await db.select().from(decks).where(eq(decks.slug, slug));
    if (!deck) return { success: false, error: `no deck with slug "${slug}" — call presentation_list` };
    if (!Array.isArray(slides) || slides.length === 0) return { success: false, error: 'slides must be a non-empty array' };
    if (slides.length > 40) return { success: false, error: 'too many top-level slides (max 40) — tighten the story' };

    const issues = slides.flatMap((s, i) => validateSlide(s, `slides[${i}]`, 0));
    if (issues.length) {
      return { success: false, error: `spec failed validation — fix these and call again:\n- ${issues.join('\n- ')}` };
    }

    const baseUrl = (process.env.PUBLIC_SITE_URL || 'https://strangeramblings.com').replace(/\/+$/, '');
    const url = `${baseUrl}/decks/${slug}`;
    ctx?.emit(`Rewriting deck at ${url} …`);

    // Snapshot the old tree so a failed rewrite can be rolled back.
    const oldRows = await db.select().from(deckSlides).where(eq(deckSlides.deckId, deck.id));
    await db.delete(deckSlides).where(eq(deckSlides.deckId, deck.id));
    let slideCount = 0;
    try {
      slideCount = await insertSlides(deck.id, slides, null);
    } catch (err) {
      // Restore the previous slides — never leave the deck empty.
      for (const row of oldRows) {
        await db.insert(deckSlides).values(row).catch(() => {});
      }
      return { success: false, error: `slide insert failed (previous content restored): ${err instanceof Error ? err.message : String(err)}` };
    }

    await db
      .update(decks)
      .set({
        updatedAt: new Date(),
        ...(typeof args.title === 'string' && args.title.trim() ? { title: args.title.trim() } : {}),
        ...(typeof args.description === 'string' ? { description: args.description } : {}),
      })
      .where(eq(decks.id, deck.id));

    const persisted = await db.select().from(deckSlides).where(eq(deckSlides.deckId, deck.id));
    const persistIssues = persisted.flatMap((row) => {
      const res = validateBlocks(row.blocks);
      return res.issues.map((i) => `slide "${row.title ?? row.id}": ${i}`);
    });

    const summaryMarkdown = [
      `**[${typeof args.title === 'string' && args.title.trim() ? args.title.trim() : deck.title}](${url})** — rewritten, ${slideCount} slides`,
      '',
      'Existing share links still work.',
      '',
      outlineMarkdown(slides),
      ...(persistIssues.length ? ['', '**Needs attention:**', ...persistIssues.map((i) => `- ${i}`)] : []),
    ].join('\n');

    return {
      success: persistIssues.length === 0,
      data: { deckId: deck.id, slug, url, slideCount, summaryMarkdown, verificationIssues: persistIssues },
    };
  },
});
