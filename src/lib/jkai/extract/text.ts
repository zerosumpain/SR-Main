// src/lib/jkai/extract/text.ts
import type { ExtractResult } from './types';

export function extractPlainText(buffer: Buffer): ExtractResult {
  const text = buffer.toString('utf8');
  return {
    text,
    meta: { kind: 'text', encoding: 'utf-8' },
  };
}
