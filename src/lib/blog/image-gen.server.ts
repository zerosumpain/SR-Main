/**
 * Article imagery — the two calls that cost money.
 *
 * Server-only. The style vocabulary and prompt composition are pure and live in
 * ./image-gen, so the editor can show the exact prompt before anything is spent.
 *
 * Both halves follow paths that already exist rather than inventing new ones:
 *
 *  - the DRAFTING call goes through the LLM gateway (`resolveDefaultModel` →
 *    `getLLMClient`), like every other model call on the site;
 *  - the GENERATION call is a bare `fetch` to OpenRouter's images endpoint,
 *    because that is the only way to reach it — there is no SDK wrapper — and
 *    it is exactly what `$lib/workflows/site-tools/tools/media-generate-image`
 *    does for jkai.
 *
 * THE CONSEQUENCE OF THAT BARE FETCH, and it is the thing most easily missed:
 * nothing wraps it, so nothing else in the codebase sees the spend. Image
 * generation billed to OpenRouter and appeared in NO ledger until the jkai tool
 * started calling `recordDurableLLMCall` itself. This module must do the same
 * or the spend tracker quietly under-reports again.
 */

import { randomUUID } from 'node:crypto';
import { getLLMClient } from '$lib/llm/client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { recordDurableLLMCall } from '$lib/llm/usage-log';
import { saveBlogImage } from '$lib/blog/image-store';
import { recordUpload } from '$lib/blog/media.server';
import { plainTextFromHtml } from '$lib/blog/readability';
import { BRIEF_SYSTEM_PROMPT, cleanBrief, composePrompt, type ImageAspect } from './image-gen';

/**
 * How much of the post the drafting model reads.
 *
 * A scene comes out of the opening and the shape of a piece, not out of its
 * fourth section. Sending 4,000 words costs real tokens per press of a button
 * an author will press repeatedly while comparing themes, and produces no
 * better a sentence.
 */
const BRIEF_INPUT_CHARS = 6000;

/** Generated images are PNG from this endpoint unless it says otherwise. */
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

async function imageModel(): Promise<string> {
  try {
    const { resolveImageToolModel } = await import('$lib/server/models/workload-settings');
    return (await resolveImageToolModel()).modelId;
  } catch (err) {
    // A settings read that fails must not stop the tool drawing — the same
    // reasoning the jkai image tool records. Falling back draws the picture;
    // throwing loses the request over a database blip.
    console.warn(
      `[blog/image-gen] could not resolve the image model (${(err as Error).message}); using the fallback`,
    );
    const { DEFAULT_IMAGE_TOOL_MODEL_ID } = await import('$lib/constants/default-models');
    return process.env.JKAI_IMAGE_MODEL ?? DEFAULT_IMAGE_TOOL_MODEL_ID;
  }
}

export type BriefInput = {
  title: string;
  excerpt: string;
  contentHtml: string;
  contentFormat?: 'html' | 'markdown';
};

/**
 * Read the article and describe one scene for it.
 *
 * Returns '' rather than throwing when there is nothing to read — a two-line
 * stub has no scene in it, and asking anyway spends a call to be told so.
 */
export async function draftImageBrief(post: BriefInput): Promise<string> {
  const plain =
    post.contentFormat === 'markdown' ? post.contentHtml : plainTextFromHtml(post.contentHtml ?? '');
  const body = (plain ?? '').replace(/\s+/g, ' ').trim();

  // Below this there is no article to read a scene out of.
  if (body.length < 200 && !post.excerpt) return '';

  const ctx = await resolveDefaultModel();
  const { client, model } = await getLLMClient(ctx);

  const res = await client.chat.completions.create({
    model,
    // Warm, because this is the one call in the blog engine whose job is to be
    // imaginative. The writing desk's extraction runs at 0.2 for the opposite
    // reason.
    temperature: 0.9,
    max_tokens: 120,
    messages: [
      { role: 'system', content: BRIEF_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `TITLE: ${post.title}\n\nSTANDFIRST: ${post.excerpt}\n\nPOST:\n${body.slice(0, BRIEF_INPUT_CHARS)}`,
      },
    ],
  });

  return cleanBrief(res.choices[0]?.message?.content ?? '');
}

export type GenerateInput = {
  postId: number;
  /** The scene. Author-editable — this is never taken straight from a model. */
  subject: string;
  styleKey: string;
  aspect: ImageAspect;
};

export type GeneratedImage = {
  url: string;
  filename: string;
  /** The exact prompt that was sent, so the author can see what produced this. */
  prompt: string;
  model: string;
  bytes: number;
  mimeType: string;
};

/**
 * Generate one image and put it in the post's media library.
 *
 * ONE image per call, deliberately. The jkai tool takes a `count` up to four
 * because a chat turn is a single throwaway ask; here the author is comparing
 * themes over a subject they are still editing, and four images per press turns
 * an afternoon of fiddling into real money. Pressing the button again is the
 * loop, and it is honest about what each press costs.
 *
 * The image lands in the ordinary blog store, so it appears in the media
 * library, serves from the same public byte route, and can be used as a cover
 * or inserted into the body like any upload. Nothing about it is special
 * downstream, which is the point.
 */
export async function generateBlogImage(input: GenerateInput): Promise<GeneratedImage> {
  const prompt = composePrompt(input.subject, input.styleKey);
  if (!prompt) throw new Error('Describe the image first — a style on its own has nothing to draw.');

  const { getOpenRouterApiKey } = await import('$lib/server/models/settings');
  const apiKey = await getOpenRouterApiKey();
  if (!apiKey) throw new Error('OpenRouter API key not configured');

  const model = await imageModel();
  const startedAt = Date.now();

  const resp = await fetch('https://openrouter.ai/api/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://strangeramblings.com/blog',
      // ASCII ONLY. An HTTP header value is a ByteString: a single em dash here
      // threw "Cannot convert argument to a ByteString because the character at
      // index 18 has a value of 8212" and failed every generation. Nothing in a
      // header may leave the 0-255 range.
      'X-Title': 'Strange Ramblings blog imagery',
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      // A TOP-LEVEL parameter, not a line appended to the prompt.
      //
      // The jkai image tool appends `aspect_ratio: 16:9` to the prompt text and
      // the current model ignores it completely — measured: every request came
      // back 1024x1024 whatever was asked for. As a parameter it is exact:
      // 16:9 → 1344x768, 9:16 → 768x1344, 4:3 → 1184x864. A model that does not
      // understand the parameter ignores it the same way it ignored the prompt
      // line, so this is strictly better and never worse.
      aspect_ratio: input.aspect,
    }),
  });

  if (!resp.ok) {
    throw new Error(`OpenRouter ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data = await resp.json();

  // Reached with a bare fetch, so no wrapper sees this spend. Images are priced
  // per image rather than per token, so the token columns stay null and the
  // cost is whatever OpenRouter reports — null rather than a fabricated zero
  // when it reports nothing.
  recordDurableLLMCall({
    provider: 'openrouter',
    model,
    tokensInput: null,
    tokensOutput: null,
    costUsd:
      typeof data?.usage?.cost === 'number' && Number.isFinite(data.usage.cost)
        ? data.usage.cost
        : null,
    durationMs: Date.now() - startedAt,
    // `source` is the MECHANISM that carried the call, `activity` is the LLM
    // ROLE that spent it — the two are kept apart precisely so a bill can be
    // attributed. This is the blog's image button (mechanism) spending the
    // `image-tool` workload's budget (role), and `image-tool` is the workload
    // `imageModel()` above actually resolves.
    source: 'blog-image',
    activity: 'image-tool',
    sessionId: null,
  });

  const item = data?.data?.[0];
  if (!item) throw new Error('OpenRouter returned no image');

  let buf: Buffer;
  let mimeType = 'image/png';

  if (item.b64_json) {
    buf = Buffer.from(item.b64_json, 'base64');
    // This endpoint reports the type as `media_type`, not `mime_type`, and the
    // models it fronts do not all return PNG. Assuming PNG writes a .png file
    // holding JPEG bytes, which serves with the wrong Content-Type.
    if (typeof item.media_type === 'string' && item.media_type.startsWith('image/')) {
      mimeType = item.media_type;
    }
  } else if (item.url) {
    const imgRes = await fetch(item.url);
    if (!imgRes.ok) throw new Error(`image download failed (${imgRes.status})`);
    mimeType = imgRes.headers.get('content-type')?.split(';')[0] ?? 'image/png';
    buf = Buffer.from(await imgRes.arrayBuffer());
  } else {
    throw new Error('no image data in the response');
  }

  const ext = MIME_TO_EXT[mimeType] ?? 'png';
  // Same shape as an upload: timestamp plus a short uuid. Prefixed so the
  // library can tell a generated asset from a photograph the author took.
  const filename = `gen-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  const postKey = String(input.postId);

  await saveBlogImage(postKey, filename, buf);
  const url = `/api/blog/images/${postKey}/${filename}`;

  // Library bookkeeping must never fail the generation: the bytes are stored
  // and the author is waiting on the URL. A failed row is recoverable; a thrown
  // error here loses an image that has already been paid for.
  try {
    await recordUpload({
      postId: input.postId,
      filename,
      url,
      mimeType,
      bytes: buf.byteLength,
    });
  } catch (e) {
    console.error('[blog/image-gen] media row not recorded:', e);
  }

  return { url, filename, prompt, model, bytes: buf.byteLength, mimeType };
}
