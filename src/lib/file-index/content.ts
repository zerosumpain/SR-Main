// Turn a stored /drive file's bytes into searchable plain text + a modality
// label, for the global @files index. Dispatch:
//   image/*  → vision caption + OCR   (describeImage)
//   audio/*  → best-effort transcript (transcribeAudioBestEffort)
//   text-extractable docs → extractText (pdf/docx/doc/pptx/markdown/spreadsheet/text)
//   everything else (video, archives, unknown binary) → skip
//
// NOTE: audio is handled directly here, NOT via extractText — extractText's
// 'audio'/'video' branches call the whisper /audio/transcriptions endpoint,
// which is unreachable through this repo's gateway. Video is deferred.

import { extractText, kindFromMime, ExtractError } from '$lib/jkai/extract';
import { describeImage, describePdfBestEffort, transcribeAudioBestEffort } from './describe';

/**
 * How a chunk's text was derived. 'ocr' is a PDF that had no text layer and was
 * read by a vision model — kept distinct from 'text' because the two have very
 * different reliability, and from 'image' because the file is a document, not a
 * picture. Consumers treat unknown values as documents, so this is additive.
 */
export type Modality = 'text' | 'image' | 'audio' | 'ocr';
export type FileContent = { text: string; modality: Modality };

/**
 * Why a file produced no text — and crucially, whether that is a VERDICT or a
 * CRASH.
 *
 * These used to be the same `null`. They must not be: 'empty' is a settled fact
 * about the document and the caller is right to stop asking, whereas 'error'
 * means we never found out. Collapsing them let a crashed extraction be recorded
 * as "this document has no text", permanently — see indexFile.
 */
export type ContentOutcome =
  | { status: 'text'; content: FileContent }
  | { status: 'empty'; reason?: string }
  | { status: 'error'; reason: string };

/** Keep a reason short enough to store and read at a glance. */
const MAX_REASON_CHARS = 400;

/**
 * Describe a failure including its CAUSE.
 *
 * ExtractError carries the underlying error, but every log site printed only
 * `err.message` — so a production PDF outage surfaced as the bare string "PDF
 * text extraction failed" with the actual reason ("Cannot find module
 * pdf.worker.mjs") thrown away at the first frame.
 */
function describeFailure(err: unknown): string {
  const parts: string[] = [];
  if (err instanceof ExtractError) parts.push(err.code);
  const message = err instanceof Error ? err.message : String(err);
  if (message) parts.push(message);
  const cause = err instanceof Error ? (err.cause as unknown) : undefined;
  if (cause) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    if (causeMessage && causeMessage !== message) parts.push(`caused by: ${causeMessage}`);
  }
  return parts.join(' — ').slice(0, MAX_REASON_CHARS);
}

/** Extract kinds whose text we index directly. Excludes audio/video (handled/skipped separately). */
const TEXT_KINDS = new Set(['pdf', 'docx', 'doc', 'pptx', 'markdown', 'spreadsheet', 'text']);

/**
 * Produce indexable text for a file. Never throws for a per-file failure — one
 * bad file can't break a batch — but a thrown extraction is reported as 'error',
 * not silently flattened into "no text".
 *
 * Note that describeImage/transcribeAudioBestEffort are best-effort by contract
 * and return null rather than throwing, so a model outage stays 'empty'. That is
 * deliberate: 'error' is retried on every backfill, and re-sending every image
 * in the Drive to a vision model on each sweep is exactly the cost the original
 * retire-on-null behaviour existed to avoid.
 */
export async function fileToText(
  buf: Buffer,
  mimeType: string,
  filename: string,
): Promise<ContentOutcome> {
  const mime = (mimeType || '').toLowerCase();
  try {
    if (mime.startsWith('image/')) {
      const text = await describeImage(buf, mimeType);
      return text ? { status: 'text', content: { text, modality: 'image' } } : { status: 'empty' };
    }
    if (mime.startsWith('audio/')) {
      const text = await transcribeAudioBestEffort(buf, mimeType);
      return text ? { status: 'text', content: { text, modality: 'audio' } } : { status: 'empty' };
    }
    const kind = kindFromMime(mimeType, filename);
    if (kind && TEXT_KINDS.has(kind)) {
      const res = await extractText(buf, mimeType, filename);
      const text = res.text?.trim();
      if (text) return { status: 'text', content: { text, modality: 'text' } };
      // A PDF that parsed cleanly but yielded nothing is a scan — pixels with no
      // text layer. pdf.js has done all it can; the pixels still say something.
      if (kind === 'pdf') {
        const ocr = await describePdfBestEffort(buf, filename);
        if (ocr) return { status: 'text', content: { text: ocr, modality: 'ocr' } };
        return { status: 'empty', reason: 'no text layer, and reading the page images produced nothing' };
      }
      return { status: 'empty' };
    }
    return { status: 'empty' };
  } catch (err) {
    const reason = describeFailure(err);
    console.warn(`[file-index] content extraction failed for ${filename}: ${reason}`);
    return { status: 'error', reason };
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
