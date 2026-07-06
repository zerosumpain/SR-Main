// src/lib/jkai/extract/docx.ts
import mammoth from 'mammoth';
import { ExtractError, type ExtractResult } from './types';

// Preserve a little more character than mammoth's default map (which drops
// underline/strikethrough) while keeping the default heading/list/table mapping.
const STYLE_MAP = ['u => u', 'strike => s'];

/** True if a cell's text reads as a number (currency, %, thousands, negatives). */
function isNumericText(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  const cleaned = t.replace(/^\(|\)$/g, '').replace(/[£$€%,\s]/g, '');
  return /^[-+]?\d*\.?\d+$/.test(cleaned);
}

/**
 * Tag numeric table cells so the viewer can right-align them (financial tables read
 * far better aligned). mammoth wraps cell content in <p>/<strong>; strip tags to test
 * the text, then add `class="num"` to a cell that is purely a number. Cells that
 * already carry a class or aren't numeric are left untouched.
 */
function markNumericCells(html: string): string {
  return html.replace(/<(td|th)((?:(?!class=)[^>])*?)>([\s\S]*?)<\/\1>/gi, (full, tag, attrs, inner) => {
    const text = inner
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .trim();
    return isNumericText(text) ? `<${tag}${attrs} class="num">${inner}</${tag}>` : full;
  });
}

export async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  let textResult: { value: string; messages: Array<{ message: string }> };
  let htmlResult: { value: string };
  try {
    textResult = await mammoth.extractRawText({ buffer });
    htmlResult = await mammoth.convertToHtml({ buffer }, { styleMap: STYLE_MAP });
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
    html: markNumericCells(htmlResult.value),
    meta: {
      kind: 'docx',
      headings,
      warnings: textResult.messages.map((mm) => mm.message),
    },
  };
}
