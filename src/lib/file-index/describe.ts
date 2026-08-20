// Turn non-text modalities into searchable text for the @files index.
//
// Image → caption + OCR: mirrors $lib/jkai/intel/preprocess.ts:ocrHandwriting
// (chat.completions with an image_url data-URL through the canonical gateway),
// but PINS an explicit OpenRouter vision model rather than the default builder
// model (a GLM model, whose vision support is unverified), with a fallback to the
// builder default and finally null. The prompt is tuned for *search* — dense,
// literal descriptions of people, clothing, colours, objects, scene, plus a
// verbatim OCR of any visible text — so a query like "blue shirt and glasses"
// matches.
//
// Audio → transcript: the OpenAI whisper /audio/transcriptions endpoint is NOT
// reachable through this repo's gateway (OpenRouter only), so transcription
// goes through a multimodal chat model that accepts an `input_audio` content part
// (Gemini on OpenRouter). Best-effort: size-capped and try/catch → null, so a
// failure just leaves the file filename-searchable rather than breaking indexing.

import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getModelCapabilities } from '$lib/server/models/capabilities';
import { resolveVisionModel, resolveAudioModel } from '$lib/server/models/workload-settings';
import type { ModelContext } from '$lib/server/models/types';


/** Skip captioning images larger than this (data-URL request bloat). */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Skip transcribing audio larger than this (base64 request bloat). */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
/**
 * Skip OCR on PDFs larger than this. Lower than the image cap because base64
 * inflates by a third and a scanned document is mostly pixels — a 15 MB scan is
 * already a 20 MB request body.
 */
const MAX_PDF_OCR_BYTES = 15 * 1024 * 1024;

const IMAGE_PROMPT =
  'Describe this image in detail so it can be found by text search. ' +
  'List: the people and what they are wearing (garments and their colours), ' +
  'notable objects, the setting/scene, actions, and mood. ' +
  'Then transcribe VERBATIM any text visible in the image (signs, labels, captions, handwriting). ' +
  'Be literal and specific; do not speculate. Return plain prose, no preamble.';

const PDF_OCR_PROMPT =
  'This is a scanned document with no machine-readable text layer. ' +
  'Transcribe ALL text you can see, VERBATIM and in reading order, page by page. ' +
  'Preserve line breaks, and keep tables as rows with their columns separated by " | ". ' +
  'Include headings, dates, reference numbers and amounts exactly as printed. ' +
  'Do not summarise, do not explain, do not add commentary. ' +
  'If a passage is genuinely illegible, write [illegible] rather than guessing. ' +
  'Return only the transcript.';

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

  const attempt = async (ctx: ModelContext): Promise<string | null> => {
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

  // The `vision` workload rather than a module constant, so this is settable
  // from the model picker. Its save guard requires image input, so the model
  // that arrives here can always actually see the picture.
  const visionCtx = await resolveVisionModel();
  try {
    return await attempt(visionCtx);
  } catch (err) {
    console.warn(
      `[file-index] ${visionCtx.modelId} caption failed (${(err as Error).message}); trying site default`,
    );
    try {
      const fallback = await resolveDefaultModel();
      // The site default is now allowed to be a Codex model, and Codex is
      // text-only — it would accept the request and answer about the prompt
      // while ignoring the image, producing a confident caption of nothing.
      // Skip rather than fabricate: a null here is a non-fatal "no caption".
      if (!getModelCapabilities(fallback).image) {
        console.warn(
          `[file-index] site default ${fallback.modelId} cannot accept images — skipping caption fallback`,
        );
        return null;
      }
      return await attempt(fallback);
    } catch (err2) {
      console.warn(`[file-index] image caption fully failed: ${(err2 as Error).message}`);
      return null;
    }
  }
}

/**
 * Did the model decline instead of transcribing?
 *
 * Vision models intermittently refuse to transcribe documents — observed on
 * gpt-4o-mini roughly one run in three against the same scan, answering "I'm
 * unable to provide the transcript…". Storing that as the file's text is worse
 * than storing nothing: it would be embedded, returned by @files, and fed to the
 * intel graph as though it were the contents of the document.
 *
 * Deliberately narrow — an explicit inability phrase near the start AND a short
 * body. A real transcript is long and does not open by apologising.
 */
export function looksLikeRefusal(text: string): boolean {
  if (text.length > 1000) return false;
  const head = text.trim().slice(0, 160).toLowerCase();
  if (/^(sorry|i'm sorry|i am sorry|unfortunately)\b/.test(head)) return true;
  return /\b(?:can'?t|cannot|unable to|not able to)\b[^.]{0,40}\b(?:provide|transcribe|read|extract|assist|help|process)\b/.test(
    head,
  );
}

/**
 * OCR a PDF that has no text layer, via the same vision model used for images.
 *
 * Only for the case where pdf.js extracted nothing: a scan, a fax, or a photo of
 * a document wrapped in a PDF. Those are common for statements and letters, and
 * until now they indexed as nothing at all — the file existed in the Drive and
 * was invisible to both @files and the intel graph.
 *
 * The PDF goes as an OpenRouter `file` content part rather than being rasterised
 * here: the same shape jkai chat attachments already use (see
 * $lib/jkai/media/multimodal.ts), so there is no image-encoding step to get
 * wrong and no native canvas dependency on a memory-constrained box.
 *
 * Best-effort by contract — returns null rather than throwing, so a model outage
 * leaves the file recorded as having no text rather than as a hard error that
 * gets retried (and re-billed) on every backfill.
 */
export async function describePdfBestEffort(buf: Buffer, filename: string): Promise<string | null> {
  if (buf.byteLength > MAX_PDF_OCR_BYTES) return null;
  const fileData = `data:application/pdf;base64,${buf.toString('base64')}`;

  const attempt = async (ctx: ModelContext): Promise<string | null> => {
    const { client, model } = await getLLMClient(ctx);
    const response = await client.chat.completions.create({
      model,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PDF_OCR_PROMPT },
            { type: 'file', file: { filename: filename || 'document.pdf', file_data: fileData } },
          ],
        },
      ],
    } as never);
    const text = (response as { choices: Array<{ message?: { content?: string } }> })
      .choices[0]?.message?.content?.trim();
    if (!text) return null;
    if (looksLikeRefusal(text)) {
      // Throw rather than return null so the caller's fallback runs — a second
      // model often obliges where the first declined, and a refusal is not
      // evidence that the document is blank.
      throw new Error(`model declined to transcribe: ${text.slice(0, 80)}`);
    }
    return text;
  };

  const visionCtx = await resolveVisionModel();
  try {
    return await attempt(visionCtx);
  } catch (err) {
    console.warn(
      `[file-index] ${visionCtx.modelId} PDF OCR failed (${(err as Error).message}); trying site default`,
    );
    try {
      const fallback = await resolveDefaultModel();
      // Same trap as the image path: the site default may be a Codex model,
      // which is text-only and would answer confidently about a document it
      // never saw. A null is an honest "no text"; a fabricated transcript of a
      // financial statement is considerably worse than nothing.
      if (!getModelCapabilities(fallback).image) {
        console.warn(
          `[file-index] site default ${fallback.modelId} cannot accept documents — skipping PDF OCR`,
        );
        return null;
      }
      return await attempt(fallback);
    } catch (err2) {
      console.warn(`[file-index] PDF OCR fully failed: ${(err2 as Error).message}`);
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
    // The `audio` workload rather than a module constant, so this is settable
    // from the model picker; its save guard requires audio input.
    const { client, model } = await getLLMClient(await resolveAudioModel());
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
