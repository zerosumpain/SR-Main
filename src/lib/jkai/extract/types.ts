// src/lib/jkai/extract/types.ts

export type ExtractKind =
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'markdown'
  | 'text'
  | 'audio'
  | 'video'
  | 'spreadsheet';

export type ExtractMeta =
  | { kind: 'pdf'; pageCount: number; pages: Array<{ index: number; text: string; error?: string }> }
  | { kind: 'docx'; headings: Array<{ level: number; text: string }>; warnings: string[] }
  | { kind: 'markdown'; headings: Array<{ level: number; text: string }> }
  | { kind: 'text'; encoding: 'utf-8' | 'latin-1' }
  | { kind: 'audio'; durationSec?: number; segments?: Array<{ start: number; end: number; text: string }>; language?: string }
  | { kind: 'video'; durationSec?: number; segments?: Array<{ start: number; end: number; text: string }>; language?: string }
  | { kind: 'spreadsheet'; sheets: Array<{ name: string; rowCount: number; columns: string[] }> };

export interface ExtractResult {
  text: string;
  meta: ExtractMeta;
}

export interface ExtractOptions {
  pages?: { from: number; to: number };
  language?: string;
}

export type SynthesizeFormat = 'docx' | 'pdf' | 'html' | 'xlsx' | 'csv';
export type SynthesizeSource = 'markdown' | 'text' | 'json' | 'csv' | 'xlsx';

export interface SynthesizeInput {
  format: SynthesizeFormat;
  source: SynthesizeSource;
  content: string | Buffer;
  title?: string;
  sheetName?: string;
}

export interface SynthesizeResult {
  buffer: Buffer;
  mimeType: string;
  suggestedExtension: string;
}

export type ExtractErrorCode =
  | 'E_UNSUPPORTED_MIME'
  | 'E_FFMPEG_MISSING'
  | 'E_PARSE_FAILED'
  | 'E_TRANSCRIBE_FAILED'
  | 'E_INVALID_INPUT'
  | 'E_SOURCE_TOO_LARGE';

export class ExtractError extends Error {
  code: ExtractErrorCode;
  cause?: unknown;
  constructor(code: ExtractErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ExtractError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export function kindFromMime(mimeType: string, filename = ''): ExtractKind | null {
  const m = (mimeType || '').toLowerCase();
  const lowerName = filename.toLowerCase();

  if (m === 'application/pdf') return 'pdf';
  if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (m === 'application/msword') return 'doc';
  if (m === 'text/markdown' || m === 'text/x-markdown' || lowerName.endsWith('.md')) return 'markdown';
  if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || m === 'application/vnd.ms-excel') return 'spreadsheet';
  if (m === 'text/csv' || lowerName.endsWith('.csv')) return 'spreadsheet';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/yaml' || m === 'application/x-yaml') return 'text';

  // Fallback by extension when octet-stream
  if (m === 'application/octet-stream' || !m) {
    if (lowerName.endsWith('.pdf')) return 'pdf';
    if (lowerName.endsWith('.docx')) return 'docx';
    if (lowerName.endsWith('.doc')) return 'doc';
    if (lowerName.endsWith('.md')) return 'markdown';
    if (lowerName.endsWith('.xlsx')) return 'spreadsheet';
    if (lowerName.endsWith('.csv')) return 'spreadsheet';
    if (lowerName.endsWith('.txt')) return 'text';
  }
  return null;
}

export const MAX_INPUT_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_DURATION_SEC = 30 * 60;
