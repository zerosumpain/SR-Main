// Turn non-text modalities into searchable text for the @files index.
//
// Image → caption + OCR: mirrors $lib/jkai/intel/preprocess.ts:ocrHandwriting
// (chat.completions with an image_url data-URL through the canonical gateway),
// but PINS an explicit OpenRouter vision model rather than the default builder
// model (glm-5.1, whose vision support is unverified), with a fallback to the
// builder default and finally null. The prompt is tuned for *search* — dense,
// literal descriptions of people, clothing, colours, objects, scene, plus a
// verbatim OCR of any visible text — so a query like "blue shirt and glasses"
// matches.
//
// Audio → transcript: the OpenAI whisper /audio/transcriptions endpoint is NOT
// reachable through this repo's gateway (z.ai + OpenRouter only), so transcription
// goes through a multimodal chat model that accepts an `input_audio` content part
// (Gemini on OpenRouter). Best-effort: size-capped and try/catch → null, so a
// failure just leaves the file filename-searchable rather than breaking indexing.

import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';

/** Pinned vision model for image captions (served by OpenRouter, cheap, reliable vision). */
const VISION_MODEL = 'openai/gpt-4o-mini';
/** Pinned audio-capable multimodal model for transcription. */
const AUDIO_MODEL = 'google/gemini-2.0-flash-001';

/** Skip captioning images larger than this (data-URL request bloat). */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Skip transcribing audio larger than this (base64 request bloat). */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const IMAGE_PROMPT =
  'Describe this image in detail so it can be found by text search. ' +
  'List: the people and what they are wearing (garments and their colours), ' +
  'notable objects, the setting/scene, actions, and mood. ' +
  'Then transcribe VERBATIM any text visible in the image (signs, labels, captions, handwriting). ' +
  'Be literal and specific; do not speculate. Return plain prose, no preamble.';

const AUDIO_PROMPT =
  'Transcribe the spoken words in this audio verbatim. If music or non-speech sounds dominate, ' +
  'briefly describe them instead. Return only the transcript/description, no preamble.';

/** Map a common audio MIME type to the format string the input_audio API expects. */
function audioFormat(mime: string): string | null {
  const m = (mime || '').toLowerCase();
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('webm')) return 'webm';
  if (m.includes('flac')) return 'flac';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  return null;
}

/**
 * Caption + OCR an image into searchable text. Returns null (skip, non-fatal)
 * on any failure or if the image is too large.
 */
export async function describeImage(buf: Buffer, mimeType: string): Promise<string | null> {
  if (buf.byteLength > MAX_IMAGE_BYTES) return null;
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${buf.toString('base64')}`;

  const attempt = async (ctx: { provider: 'openrouter' | 'zai'; modelId: string }): Promise<string | null> => {
    const { client, model } = await getLLMClient(ctx);
    const response = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: IMAGE_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    });
    const text = response.choices[0]?.message?.content?.trim();
    return text ? text : null;
  };

  try {
    return await attempt({ provider: 'openrouter', modelId: VISION_MODEL });
  } catch (err) {
    console.warn(`[file-index] ${VISION_MODEL} caption failed (${(err as Error).message}); trying builder default`);
    try {
      const fallback = await resolveDefaultModel('builder');
      return await attempt({ provider: fallback.provider as 'openrouter' | 'zai', modelId: fallback.modelId });
    } catch (err2) {
      console.warn(`[file-index] image caption fully failed: ${(err2 as Error).message}`);
      return null;
    }
  }
}

/**
 * Best-effort transcription of an audio file into searchable text via a
 * multimodal chat model. Returns null (skip, non-fatal) on any failure, an
 * unsupported format, or an oversized file.
 */
export async function transcribeAudioBestEffort(buf: Buffer, mimeType: string): Promise<string | null> {
  if (buf.byteLength > MAX_AUDIO_BYTES) return null;
  const format = audioFormat(mimeType);
  if (!format) return null;

  try {
    const { client, model } = await getLLMClient({ provider: 'openrouter', modelId: AUDIO_MODEL });
    const response = await client.chat.completions.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: AUDIO_PROMPT },
            // OpenRouter multimodal audio content part.
            { type: 'input_audio', input_audio: { data: buf.toString('base64'), format } },
          ],
        },
      ],
    } as never);
    const text = (response as { choices: Array<{ message?: { content?: string } }> })
      .choices[0]?.message?.content?.trim();
    return text ? text : null;
  } catch (err) {
    console.warn(`[file-index] audio transcription failed (${(err as Error).message}); skipping`);
    return null;
  }
}
