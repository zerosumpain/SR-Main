// src/lib/workflows/site-tools/tools/media-generate-image.ts
// Generation tool: produce images from text prompts via OpenRouter FLUX,
// saving each result as a conversation attachment.

import { register } from '../registry-internal';
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { saveBuffer } from '$lib/jkai/media/storage';
import { checkImageQuota } from '$lib/jkai/media/rate-limits';
import type { JkaiAttachment } from '$lib/db/schema';

const DEFAULT_MODEL = process.env.JKAI_IMAGE_MODEL ?? 'black-forest-labs/flux-1.1-pro';

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
        model: DEFAULT_MODEL,
        prompt: `${args.prompt}\n\naspect_ratio: ${aspect}`,
        n: 1,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { success: attachments.length > 0, error: `OpenRouter ${resp.status}: ${errText}`, attachments };
    }
    const data = await resp.json();

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
      metadata: { prompt: args.prompt, model: DEFAULT_MODEL, aspectRatio: aspect },
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
