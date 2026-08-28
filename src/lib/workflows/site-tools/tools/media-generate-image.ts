// src/lib/workflows/site-tools/tools/media-generate-image.ts
// Generation tool: produce images from text prompts via OpenRouter FLUX,
// saving each result as a conversation attachment.

import { register } from '../registry-internal';
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { saveBuffer } from '$lib/jkai/media/storage';
import { checkImageQuota } from '$lib/jkai/media/rate-limits';
import { recordDurableLLMCall } from '$lib/llm/usage-log';
import type { JkaiAttachment } from '$lib/db/schema';

/** Resolved per call from the `image-tool` workload rather than read once at
 *  module load, so a model change from /admin/ops/costs takes effect without a
 *  restart. `resolveImageToolModel` still honours JKAI_IMAGE_MODEL underneath an
 *  explicit pin, so nothing moves for a deployment that sets it. */
async function imageModel(): Promise<string> {
  try {
    const { resolveImageToolModel } = await import('$lib/server/models/workload-settings');
    return (await resolveImageToolModel()).modelId;
  } catch (err) {
    // Same shape as resolveVisionModel's routing lookup: a settings read that
    // fails must not stop the tool drawing. Falling back to the constant draws
    // the picture; throwing loses the user's request over a database blip.
    console.warn(
      `[generate_image] could not resolve the image-tool model (${(err as Error).message}); using the fallback`,
    );
    const { DEFAULT_IMAGE_TOOL_MODEL_ID } = await import('$lib/constants/default-models');
    return process.env.JKAI_IMAGE_MODEL ?? DEFAULT_IMAGE_TOOL_MODEL_ID;
  }
}

export interface GenerateImageArgs {
  prompt: string;
  aspect_ratio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  count?: number;
}

export interface GenerateImageResult {
  success: boolean;
  error?: string;
  attachments?: JkaiAttachment[];
}

export interface ToolContext {
  conversationId: string | null;
  messageId: string | null;
}

async function getApiKey(): Promise<string | null> {
  try {
    const { getOpenRouterApiKey } = await import('$lib/server/models/settings');
    const key = await getOpenRouterApiKey();
    return key ?? null;
  } catch {
    return null;
  }
}

export async function handleGenerateImage(
  args: GenerateImageArgs,
  ctx: ToolContext,
): Promise<GenerateImageResult> {
  const apiKey = await getApiKey();
  if (!apiKey) return { success: false, error: 'OpenRouter API key not configured' };
  if (!args.prompt || args.prompt.length < 2) return { success: false, error: 'prompt required' };
  const count = Math.min(Math.max(args.count ?? 1, 1), 4);
  const aspect = args.aspect_ratio ?? '1:1';

  if (ctx.conversationId) {
    const q = await checkImageQuota(ctx.conversationId, count);
    if (!q.allowed) return { success: false, error: q.reason };
  }

  const attachments: JkaiAttachment[] = [];
  const model = await imageModel();

  for (let i = 0; i < count; i++) {
    const resp = await fetch('https://openrouter.ai/api/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://strangeramblings.com/jkai',
        'X-Title': 'JKAI',
      },
      body: JSON.stringify({
        model,
        prompt: `${args.prompt}\n\naspect_ratio: ${aspect}`,
        n: 1,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { success: attachments.length > 0, error: `OpenRouter ${resp.status}: ${errText}`, attachments };
    }
    const data = await resp.json();

    // This endpoint is reached with a bare `fetch`, not the wrapped SDK client,
    // so nothing else in the codebase sees the spend: image generation was
    // billing to OpenRouter and appearing in no ledger at all. Record it here.
    // Images are priced per image, not per token, so the token columns stay
    // null and the cost is whatever OpenRouter reports — null rather than a
    // fabricated zero when it reports nothing.
    recordDurableLLMCall({
      provider: 'openrouter',
      model,
      tokensInput: null,
      tokensOutput: null,
      costUsd:
        typeof data?.usage?.cost === 'number' && Number.isFinite(data.usage.cost)
          ? data.usage.cost
          : null,
      source: 'gateway',
      activity: 'image-tool',
      sessionId: ctx.conversationId,
    });

    // OpenRouter image gen returns { data: [{ url, b64_json }] }
    const item = data.data?.[0];
    if (!item) return { success: false, error: 'OpenRouter returned no image' };

    let buf: Buffer;
    let mime = 'image/png';

    if (item.b64_json) {
      buf = Buffer.from(item.b64_json, 'base64');
    } else if (item.url) {
      const imgRes = await fetch(item.url);
      if (!imgRes.ok) return { success: false, error: `image download ${imgRes.status}` };
      mime = imgRes.headers.get('content-type')?.split(';')[0] ?? 'image/png';
      buf = Buffer.from(await imgRes.arrayBuffer());
    } else {
      return { success: false, error: 'no image data in response' };
    }

    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
    const { diskPath, sizeBytes } = await saveBuffer(buf, ext);
    const [row] = await db.insert(jkaiAttachments).values({
      conversationId: ctx.conversationId,
      messageId: ctx.messageId,
      source: 'generated',
      kind: 'image',
      mimeType: mime,
      originalName: `${args.prompt.slice(0, 40).replace(/[^a-z0-9]/gi, '_')}.${ext}`,
      sizeBytes,
      diskPath,
      duration: null,
      metadata: { prompt: args.prompt, model, aspectRatio: aspect },
    }).returning();
    attachments.push(row);
  }

  return { success: true, attachments };
}

register({
  name: 'generate_image',
  description:
    'Generate one to four images from a text prompt. Saves each image as a conversation attachment the user can view and download inline.',
  toolset: 'media',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Descriptive text prompt for the image.' },
      aspect_ratio: {
        type: 'string',
        enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        description: 'Image aspect ratio; default 1:1.',
      },
      count: {
        type: 'integer',
        minimum: 1,
        maximum: 4,
        description: 'Number of images to produce; default 1.',
      },
    },
    required: ['prompt'],
  },
  handler: async (args, ctx) => {
    const typedArgs: GenerateImageArgs = {
      prompt: String(args.prompt ?? ''),
      aspect_ratio: args.aspect_ratio as GenerateImageArgs['aspect_ratio'],
      count: typeof args.count === 'number' ? args.count : undefined,
    };
    return handleGenerateImage(typedArgs, {
      conversationId: ctx?.conversationId ?? null,
      messageId: null,
    });
  },
});
