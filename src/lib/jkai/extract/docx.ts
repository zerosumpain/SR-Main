// src/lib/jkai/extract/docx.ts
import mammoth from 'mammoth';
import { ExtractError, type ExtractResult } from './types';

export async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  let textResult: { value: string; messages: Array<{ message: string }> };
  let htmlResult: { value: string };
  try {
    textResult = await mammoth.extractRawText({ buffer });
    htmlResult = await mammoth.convertToHtml({ buffer });
  } catch (err) {
    throw new ExtractError('E_PARSE_FAILED', 'mammoth failed', err);
  }

  const headings: Array<{ level: number; text: string }> = [];
  const re = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(htmlResult.value)) !== null) {
    const level = parseInt(m[1] ?? '1', 10);
    const text = (m[2] ?? '').replace(/<[^>]+>/g, '').trim();
    if (text) headings.push({ level, text });
  }

  return {
    text: textResult.value,
    // mammoth already produced formatted HTML above — surface it for rich preview
    // rather than discarding it (headings, lists, tables, inline images as data:).
    html: htmlResult.value,
    meta: {
      kind: 'docx',
      headings,
      warnings: textResult.messages.map((mm) => mm.message),
    },
  };
}
