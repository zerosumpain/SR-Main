/**
 * Article imagery for one post.
 *
 * Owner-gated by hooks.server.ts because it lives under /api/admin — there is
 * deliberately no auth code here and no allow-list entry.
 *
 * TWO VERBS, and the split is the whole design:
 *
 *   POST ?step=brief  — read the article, return a SUGGESTED scene. Cheap, one
 *                       text call, changes nothing.
 *   POST              — generate an image from the scene the author has in the
 *                       box. Costs an image.
 *
 * They are separate because the brief is a draft the author edits. Fusing them
 * into one "generate from article" button would spend an image on a sentence
 * nobody has read, and the sentence is the part that decides whether the
 * picture is any good.
 */

import { json } from '@sveltejs/kit';
import { getPostById } from '$lib/blog';
import { DEFAULT_ASPECT, DEFAULT_STYLE, MAX_SUBJECT_LENGTH, isAspect } from '$lib/blog/image-gen';
import { draftImageBrief, generateBlogImage } from '$lib/blog/image-gen.server';
import type { RequestHandler } from './$types';

/**
 * A cheap in-process ceiling.
 *
 * Not anti-abuse — this route already requires an owner session. It is an
 * anti-ACCIDENT guard: a stuck retry loop in a browser tab, or a held-down
 * keyboard shortcut, spending an image per press. It resets on deploy, which is
 * fine for what it is protecting against.
 */
const MAX_PER_WINDOW = 20;
const WINDOW_MS = 10 * 60_000;
let windowStartedAt = 0;
let windowCount = 0;

function withinBudget(): boolean {
  const now = Date.now();
  if (now - windowStartedAt > WINDOW_MS) {
    windowStartedAt = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount <= MAX_PER_WINDOW;
}

export const POST: RequestHandler = async ({ params, request, url }) => {
  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id)) return json({ error: 'Invalid post id' }, { status: 400 });

  const post = await getPostById(id);
  if (!post) return json({ error: 'Not found' }, { status: 404 });

  // ---- step 1: draft a scene from the article -----------------------------
  if (url.searchParams.get('step') === 'brief') {
    try {
      const subject = await draftImageBrief({
        title: post.title,
        excerpt: post.excerpt ?? '',
        contentHtml: post.content ?? '',
        contentFormat: (post.contentFormat as 'html' | 'markdown') ?? 'html',
      });
      // An empty brief is a real answer, not an error: the post is too short to
      // read a scene out of. Say so rather than returning a 500 the UI has to
      // guess at.
      return json({ subject, reason: subject ? null : 'too-short' });
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : 'Could not read the post' },
        { status: 502 },
      );
    }
  }

  // ---- step 2: generate ---------------------------------------------------
  let body: { subject?: unknown; style?: unknown; aspect?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (!subject) {
    return json({ error: 'Describe the image first.' }, { status: 400 });
  }
  if (subject.length > MAX_SUBJECT_LENGTH * 2) {
    return json({ error: 'That description is too long.' }, { status: 400 });
  }

  // Both fall back rather than 400: an unknown style resolves to the house
  // default in `findStyle`, and refusing to draw because a stale tab sent an
  // old key would be a worse failure than drawing in the default style.
  const style = typeof body.style === 'string' ? body.style : DEFAULT_STYLE;
  const aspect = isAspect(body.aspect) ? body.aspect : DEFAULT_ASPECT;

  if (!withinBudget()) {
    return json(
      { error: 'That is a lot of images in ten minutes. Give it a moment.' },
      { status: 429, headers: { 'Retry-After': '600' } },
    );
  }

  try {
    const image = await generateBlogImage({ postId: id, subject, styleKey: style, aspect });
    return json({ image });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : 'Image generation failed' },
      { status: 502 },
    );
  }
};
