// Owner-only "revise the current slide with an instruction" (hook-gated like
// all /api/decks). Stateless by design: the editor sends its live slide state
// (which may hold unsaved edits) and applies the revision locally as a dirty
// change — the existing PATCH + expectedVersion path stays the only writer.

import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { decks } from '$lib/db/schema';
import { reviseSlide } from '$lib/decks/composer.server';
import { validateBlocks } from '$lib/presentation/registry';
import { isLayout } from '$lib/presentation/layouts';
import type { Block } from '$lib/presentation/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
  let body: { instruction?: unknown; mediaUrls?: unknown; slide?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const [deck] = await db.select().from(decks).where(eq(decks.id, params.id));
  if (!deck) return json({ error: 'Unknown deck' }, { status: 404 });

  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (!instruction) return json({ error: 'Provide an instruction' }, { status: 400 });
  if (instruction.length > 4000) return json({ error: 'Instruction too long (max 4000 chars)' }, { status: 400 });
  const mediaUrls = Array.isArray(body.mediaUrls) ? body.mediaUrls.filter((u): u is string => typeof u === 'string') : [];

  const slide = body.slide as { title?: unknown; layout?: unknown; blocks?: unknown } | null;
  if (!slide || typeof slide !== 'object' || !Array.isArray(slide.blocks)) {
    return json({ error: 'slide {title, layout, blocks} required' }, { status: 400 });
  }
  const check = validateBlocks(slide.blocks);
  if (!check.ok) return json({ error: 'Current slide blocks invalid', issues: check.issues }, { status: 400 });

  const current = {
    title: typeof slide.title === 'string' && slide.title.trim() ? slide.title : null,
    layout: isLayout(slide.layout) ? slide.layout : 'default',
    blocks: slide.blocks as Block[],
  };

  const revised = await reviseSlide(current, instruction, mediaUrls, { deckTitle: deck.title });
  if (!revised) return json({ error: 'The model could not produce a valid revision — try rewording' }, { status: 502 });
  return json({ ok: true, slide: revised });
};
