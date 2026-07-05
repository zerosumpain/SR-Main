// Turn a stored /drive file's bytes into searchable plain text + a modality
// label, for the global @files index. Dispatch:
//   image/*  → vision caption + OCR   (describeImage)
//   audio/*  → best-effort transcript (transcribeAudioBestEffort)
//   text-extractable docs → extractText (pdf/docx/doc/pptx/markdown/spreadsheet/text)
//   everything else (video, archives, unknown binary) → null (skip)
//
// NOTE: audio is handled directly here, NOT via extractText — extractText's
// 'audio'/'video' branches call the whisper /audio/transcriptions endpoint,
// which is unreachable through this repo's gateway. Video is deferred.

import { extractText, kindFromMime } from '$lib/jkai/extract';
import { describeImage, transcribeAudioBestEffort } from './describe';

export type Modality = 'text' | 'image' | 'audio';
export type FileContent = { text: string; modality: Modality };

/** Extract kinds whose text we index directly. Excludes audio/video (handled/skipped separately). */
const TEXT_KINDS = new Set(['pdf', 'docx', 'doc', 'pptx', 'markdown', 'spreadsheet', 'text']);

/**
 * Produce indexable text for a file, or null if it is not indexable / extraction
 * yielded nothing. Never throws for a per-file failure — logs and returns null so
 * one bad file can't break a batch.
 */
export async function fileToText(
  buf: Buffer,
  mimeType: string,
  filename: string,
): Promise<FileContent | null> {
  const mime = (mimeType || '').toLowerCase();
  try {
    if (mime.startsWith('image/')) {
      const text = await describeImage(buf, mimeType);
      return text ? { text, modality: 'image' } : null;
    }
    if (mime.startsWith('audio/')) {
      const text = await transcribeAudioBestEffort(buf, mimeType);
      return text ? { text, modality: 'audio' } : null;
    }
    const kind = kindFromMime(mimeType, filename);
    if (kind && TEXT_KINDS.has(kind)) {
      const res = await extractText(buf, mimeType, filename);
      const text = res.text?.trim();
      return text ? { text, modality: 'text' } : null;
    }
    return null;
  } catch (err) {
    console.warn(`[file-index] content extraction failed for ${filename}: ${(err as Error).message}`);
    return null;
  }
}

/** Cheap pre-check: would this file ever be indexable (before reading bytes)? */
export function isIndexableMime(mimeType: string, filename = ''): boolean {
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  if (mime.startsWith('audio/')) return true;
  const kind = kindFromMime(mimeType, filename);
  return !!kind && TEXT_KINDS.has(kind);
}
