// src/lib/workflows/site-tools/tools/media-generate-audio-tts.ts
// Generation tool: synthesise spoken audio (MP3) from text using ElevenLabs TTS,
// saving each result as a conversation attachment.

import { register } from '../registry-internal';
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { saveBuffer } from '$lib/jkai/media/storage';
import { loadKeys } from '$lib/deepdive/keys';
import { checkTtsQuota } from '$lib/jkai/media/rate-limits';
import type { JkaiAttachment } from '$lib/db/schema';

const DEFAULT_MODEL = process.env.JKAI_TTS_MODEL ?? 'eleven_turbo_v2_5';
const DEFAULT_VOICE = process.env.JKAI_TTS_VOICE ?? '21m00Tcm4TlvDq8ikWAM'; // Rachel
const MAX_CHARS = 5000;

export interface GenerateAudioTtsArgs {
  text: string;
  voice?: string;
  model?: 'eleven_turbo_v2_5' | 'eleven_multilingual_v2';
}

export interface GenerateAudioTtsResult {
  success: boolean;
  error?: string;
  attachments?: JkaiAttachment[];
}

export interface ToolContext {
  conversationId: string | null;
  messageId: string | null;
}

export async function handleGenerateAudioTts(
  args: GenerateAudioTtsArgs,
  ctx: ToolContext,
): Promise<GenerateAudioTtsResult> {
  const keys = loadKeys();
  const apiKey = keys.elevenlabsApiKey || process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { success: false, error: 'ElevenLabs API key not configured' };
  if (!args.text || args.text.length < 1) return { success: false, error: 'text required' };
  if (args.text.length > MAX_CHARS) return { success: false, error: `text exceeds ${MAX_CHARS} chars` };

  if (ctx.conversationId) {
    const q = await checkTtsQuota(ctx.conversationId, args.text.length);
    if (!q.allowed) return { success: false, error: q.reason };
  }

  const voice = args.voice ?? DEFAULT_VOICE;
  const model = args.model ?? DEFAULT_MODEL;

  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: args.text,
      model_id: model,
      voice_settings: { stability: 0.5, similarity_boost: 0.7 },
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    return { success: false, error: `ElevenLabs ${resp.status}: ${errText}` };
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  const { diskPath, sizeBytes } = await saveBuffer(buf, 'mp3');
  const [row] = await db
    .insert(jkaiAttachments)
    .values({
      conversationId: ctx.conversationId,
      messageId: ctx.messageId,
      source: 'generated',
      kind: 'audio',
      mimeType: 'audio/mpeg',
      originalName: `tts-${Date.now()}.mp3`,
      sizeBytes,
      diskPath,
      duration: null,
      metadata: { text: args.text.slice(0, 200), voice, model, characters: args.text.length },
    })
    .returning();
  return { success: true, attachments: [row] };
}

register({
  name: 'generate_audio_tts',
  description:
    'Synthesise spoken audio (MP3) from text using ElevenLabs. Saves as a conversation attachment. Use when the user asks you to speak, read aloud, or produce a voice note.',
  toolset: 'media',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to speak (max 5000 chars).' },
      voice: { type: 'string', description: 'ElevenLabs voice ID. Optional; uses default.' },
      model: {
        type: 'string',
        enum: ['eleven_turbo_v2_5', 'eleven_multilingual_v2'],
        description: 'Optional model.',
      },
    },
    required: ['text'],
  },
  handler: async (args) => {
    return handleGenerateAudioTts(args as any);
  },
});
