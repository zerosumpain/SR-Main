// src/lib/jkai/extract/index.ts
import {
  ExtractError,
  kindFromMime,
  MAX_INPUT_BYTES,
  type ExtractOptions,
  type ExtractResult,
  type SynthesizeInput,
  type SynthesizeResult,
} from './types';
import { extractPlainText } from './text';
import { extractMarkdown } from './markdown';
import { extractPdf } from './pdf';
import { extractDocx } from './docx';
import { extractPptx } from './pptx';
import { extractSpreadsheet } from './spreadsheet';
import { extractAudio } from './audio';
import { extractVideo } from './video';
import { synthesizeHtml } from './synth-html';
import { synthesizeDocx } from './synth-docx';
import { synthesizePdf } from './synth-pdf';
import { synthesizeSpreadsheet } from './synth-spreadsheet';

export * from './types';

export async function extractText(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  options?: ExtractOptions,
): Promise<ExtractResult> {
  if (buffer.byteLength > MAX_INPUT_BYTES) {
    throw new ExtractError('E_SOURCE_TOO_LARGE', `input is ${buffer.byteLength} bytes; max ${MAX_INPUT_BYTES}`);
  }
  const kind = kindFromMime(mimeType, filename);
  if (!kind) {
    throw new ExtractError('E_UNSUPPORTED_MIME', `cannot extract from mime ${mimeType} (filename ${filename})`);
  }

  switch (kind) {
    case 'pdf': return extractPdf(buffer, options);
    case 'docx':
    case 'doc': return extractDocx(buffer);
    case 'pptx': return extractPptx(buffer);
    case 'markdown': return extractMarkdown(buffer);
    case 'text': return extractPlainText(buffer);
    case 'spreadsheet': return extractSpreadsheet(buffer, mimeType, filename);
    case 'audio': return extractAudio(buffer, mimeType, filename, options);
    case 'video': return extractVideo(buffer, mimeType, filename, options);
  }
}

export async function synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
  const { format, source, content, title, sheetName } = input;
  const text = (): string => (typeof content === 'string' ? content : content.toString('utf8'));

  // Validate combinations per spec
  if (source === 'markdown' && format === 'html') return synthesizeHtml(text(), title);
  if (source === 'markdown' && format === 'docx') return synthesizeDocx(text(), title);
  if (source === 'markdown' && format === 'pdf') return synthesizePdf(text(), title);
  if (source === 'text' && format === 'pdf') return synthesizePdf(text(), title);
  if ((source === 'json' || source === 'csv' || source === 'xlsx') && (format === 'xlsx' || format === 'csv')) {
    return synthesizeSpreadsheet(source, format, content, sheetName);
  }

  throw new ExtractError('E_INVALID_INPUT', `unsupported source/format combination: ${source} → ${format}`);
}
