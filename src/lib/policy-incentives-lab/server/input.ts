import { randomUUID, createHash } from 'node:crypto';
import { sourceSchema, type PolicySource } from '../schemas';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT = 250000;
const directive = /(?:ignore\s+(?:all\s+)?(?:previous|prior|system)|system\s*prompt|developer\s*message|you\s+are\s+(?:now|chatgpt)|reveal\s+(?:secrets|credentials)|<\/?(?:system|assistant|tool)>|execute\s+(?:this|the)\s+(?:code|command))/i;
/** Preserve original evidence; only the separate model-input view is redacted. */
export function neutralise(text: string): { text: string; flags: string[] } {
  const flags: string[] = [];
  const lines = text.split('\n').map((line, i) => {
    if (!directive.test(line)) return line;
    flags.push(`Possible instruction in source line ${i + 1}; excluded from model input. Review original evidence.`);
    return '[UNTRUSTED DIRECTIVE OMITTED — original retained in evidence source]';
  });
  return { text: lines.join('\n'), flags };
}
export function makeSource(metadata: unknown, sections: PolicySource['text_sections'], bytes: Buffer): PolicySource {
  const length = sections.reduce((n, s) => n + s.text.length, 0);
  if (!length || length > MAX_TEXT || sections.length > 500) throw new Error('Source must contain 1–250000 characters in at most 500 sections');
  const input_flags = sections.flatMap(s => neutralise(s.text).flags.map(f => `${s.location}: ${f}`));
  return sourceSchema.parse({ ...(metadata as object), id: randomUUID(), document_hash: createHash('sha256').update(bytes).digest('hex'), text_sections: sections, input_flags });
}
export async function parseUpload(bytes: Buffer, filename: string, mime: string) {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('File exceeds 5 MiB limit');
  const extension = filename.split('.').pop()?.toLowerCase();
  const expected: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain' };
  if (!extension || !expected[extension] || (mime && mime !== 'application/octet-stream' && mime !== expected[extension])) throw new Error('Only PDF, DOCX or TXT with matching content type are supported');
  if (extension === 'txt') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('TXT contains binary data');
    return [{ id: 'section-1', location: 'Section 1', text }];
  }
  if (extension === 'pdf') {
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Invalid PDF signature');
    const { extractPdf } = await import('$lib/jkai/extract/pdf');
    const result = await extractPdf(bytes, { maxPages: 200, maxCharacters: MAX_TEXT });
    if (result.meta.kind !== 'pdf') throw new Error('Unexpected PDF extraction type');
    return result.meta.pages.map(p => ({ id: `page-${p.index}`, location: `Page ${p.index}`, text: p.text }));
  }
  if (bytes.length < 4 || bytes.readUInt16LE(0) !== 0x4b50) throw new Error('Invalid DOCX signature');
  // Reject zip bombs before invoking mammoth. ZIP central-directory sizes are
  // untrusted but provide a cheap first bound; extracted text is bounded too.
  let total = 0;
  for (let i = 0; i + 46 <= bytes.length; i++) if (bytes.readUInt32LE(i) === 0x02014b50) total += bytes.readUInt32LE(i + 24);
  if (total > 20 * 1024 * 1024) throw new Error('DOCX decompressed size exceeds 20 MiB');
  const { extractDocx } = await import('$lib/jkai/extract/docx');
  const result = await extractDocx(bytes);
  return [{ id: 'section-1', location: 'Extracted DOCX text (page unavailable)', text: result.text }];
}
