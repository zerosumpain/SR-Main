import { createHash } from 'node:crypto';
import { extractPdf } from '$lib/jkai/extract/pdf';
import { extractDocx } from '$lib/jkai/extract/docx';
import { artefact, DEPTHS, MAX_BYTES, MAX_CHARACTERS, MAX_PAGES, type Artefact, type Depth, type StageOutput } from '../contracts';
import { PolicyError } from '../validation';

export type Submission = { title: string; jurisdiction: string | null; policyArea: string | null; context: string | null; depth: Depth; filename: string; mimeType: string; bytes: Buffer };
const MIME: Record<string, string> = { txt: 'text/plain', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
export function validateBytes(bytes: Buffer, filename: string, mimeType: string): string {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new PolicyError('size', 'Supply a nonempty document of at most 10 MB.');
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  const expected = MIME[extension];
  if (!expected || (mimeType && mimeType !== 'application/octet-stream' && mimeType !== expected)) throw new PolicyError('type', 'Use a PDF, DOCX or UTF-8 TXT document.');
  if (extension === 'pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw new PolicyError('type', 'The file is not a PDF.');
  if (extension === 'docx') {
    if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) throw new PolicyError('type', 'The file is not a DOCX.');
    let expanded = 0, entries = 0;
    // Read ZIP central directory sizes before handing the archive to Mammoth.
    for (let i = 0; i + 46 <= bytes.length; i++) {
      if (bytes.readUInt32LE(i) !== 0x02014b50) continue;
      const size = bytes.readUInt32LE(i + 24);
      const nameLength = bytes.readUInt16LE(i + 28);
      const name = bytes.subarray(i + 46, i + 46 + nameLength).toString();
      expanded += size; entries++;
      if (size === 0xffffffff || expanded > 30 * 1024 * 1024 || entries > 2000 || name.split(/[\\/]/).includes('..')) throw new PolicyError('archive', 'The DOCX archive exceeds safe extraction limits.');
      i += 45 + nameLength + bytes.readUInt16LE(i + 30) + bytes.readUInt16LE(i + 32);
    }
    if (!entries) throw new PolicyError('archive', 'The DOCX archive has no readable directory.');
  }
  return expected;
}
export async function readSubmission(request: Request): Promise<Submission> {
  const limit = MAX_BYTES + 700_000;
  if (Number(request.headers.get('content-length')) > limit) throw new PolicyError('size', 'The submission exceeds the upload limit.');
  const reader = request.body?.getReader();
  if (!reader) throw new PolicyError('input', 'No submission was received.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new PolicyError('size', 'The submission exceeds the upload limit.'); }
    chunks.push(value);
  }
  let form: FormData;
  try { form = await new Request('http://policy.invalid', { method: 'POST', headers: { 'content-type': request.headers.get('content-type') ?? '' }, body: Buffer.concat(chunks) }).formData(); }
  catch { throw new PolicyError('input', 'Use the policy submission form.'); }
  const str = (key: string, max: number) => {
    const v = form.get(key);
    if (v != null && typeof v !== 'string') throw new PolicyError('input', 'Invalid form field.');
    const s = (v ?? '').trim();
    if (s.length > max) throw new PolicyError('input', `${key} exceeds its length limit.`);
    return s;
  };
  const title = str('title', 240);
  if (!title) throw new PolicyError('input', 'Enter a title.');
  const pasted = str('text', MAX_CHARACTERS);
  const file = form.get('document');
  const uploaded = file && typeof file !== 'string' && file.size > 0;
  if (uploaded && pasted) throw new PolicyError('input', 'Supply either a document or pasted text.');
  const filename = uploaded ? file.name.replace(/^.*[\\/]/, '').slice(0, 200) : 'policy.txt';
  const bytes = uploaded ? Buffer.from(await file.arrayBuffer()) : Buffer.from(pasted);
  const mimeType = validateBytes(bytes, filename, uploaded ? file.type : 'text/plain');
  const requested = str('depth', 20);
  const depth: Depth = (DEPTHS as readonly string[]).includes(requested) ? requested as Depth : 'standard';
  return { title, jurisdiction: str('jurisdiction', 200) || null, policyArea: str('policyArea', 200) || null, context: str('context', 5000) || null, depth, filename, mimeType, bytes };
}
export async function ingest(bytes: Buffer, filename: string, mimeType: string): Promise<StageOutput & { text: string; metadata: unknown }> {
  validateBytes(bytes, filename, mimeType);
  let text = ''; let metadata: unknown = {}; const warnings: string[] = [];
  let sections: { text: string; page: number | null; section: string }[] = [];
  try {
    if (mimeType === MIME.pdf) {
      const result = await extractPdf(bytes, { maxPages: MAX_PAGES, maxCharacters: MAX_CHARACTERS });
      text = result.text; metadata = result.meta;
      if (result.meta.kind === 'pdf') sections = result.meta.pages.map((p) => {
        if (p.error || !p.text.trim()) warnings.push(`Page ${p.index}: no readable text; scanned content may need OCR.`);
        return { text: p.text, page: p.index, section: `Page ${p.index}` };
      });
    } else if (mimeType === MIME.docx) {
      const result = await extractDocx(bytes); text = result.text; metadata = result.meta;
      if (result.meta.kind === 'docx') warnings.push(...result.meta.warnings);
      warnings.push('DOCX page numbers are unavailable; references use text offsets and sections.');
    } else {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text.includes('\0')) throw new Error('binary');
    }
  } catch { throw new PolicyError('extraction', 'Document extraction failed. Try a text-based PDF, DOCX or UTF-8 TXT, or paste the policy text.'); }
  // Two very different problems used to share one message, so a 300-page policy
  // was told its PDF might need OCR.
  if (!text.trim()) throw new PolicyError('extraction', 'No readable text was found. A scanned PDF needs OCR before submission, or paste the policy text instead.');
  if (text.length > MAX_CHARACTERS) throw new PolicyError('extraction', `This document holds ${Math.round(text.length / 1000).toLocaleString()},000 characters of text and the limit is ${MAX_CHARACTERS / 1000},000 — roughly ${Math.round(MAX_CHARACTERS / 3000)} pages. Submit it in parts; the cross-policy stage will compare them against each other.`);
  if (!sections.length) sections = [{ text, page: null, section: 'Policy text' }];
  const hash = createHash('sha256').update(bytes).digest('hex');
  const artefacts: Artefact[] = []; let offset = 0;
  // Bound each passage without dropping text; offsets refer to this canonical extraction.
  const canonical = sections.map((s) => s.text).join('\n\n');
  for (const s of sections) {
    for (let start = 0; start < s.text.length; start += 7000) {
      const passage = s.text.slice(start, start + 7000);
      if (!passage.trim()) continue;
      // Zero-padded: artefacts load back ordered by id, so `passage_10` must not
      // sort between `passage_1` and `passage_2` and shuffle the document.
      const id = `passage_${String(artefacts.length + 1).padStart(4, '0')}`;
      artefacts.push(artefact(id, 'passage', `${s.section} · passage ${artefacts.length + 1}`, passage, { documentHash: hash }, { origin: 'extracted_fact', confidence: 1, page: s.page, section: s.section, startOffset: offset + start, endOffset: offset + start + passage.length }));
    }
    offset += s.text.length + 2;
  }
  return { artefacts, warnings, text: canonical, metadata };
}
