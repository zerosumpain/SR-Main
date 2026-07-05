// src/lib/jkai/extract/pptx.ts
// PowerPoint (.pptx) text extraction. A .pptx is an OOXML zip; slide text lives
// in `ppt/slides/slideN.xml` inside <a:t> runs, and speaker notes in
// `ppt/notesSlides/notesSlideN.xml`. We read the runs directly rather than pull
// in a full XML parser — the same lightweight approach docx/xlsx handlers take
// with their format libs.
import JSZip from 'jszip';
import { ExtractError, type ExtractResult } from './types';

const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;
const NOTES_RE = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/;
const RUN_RE = /<a:t>([\s\S]*?)<\/a:t>/g;

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&'); // last, so decoded entities aren't re-decoded
}

/** Pull all <a:t> text runs from a slide/notes XML, in document order. */
function runsFrom(xml: string): string {
  const parts: string[] = [];
  RUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RUN_RE.exec(xml)) !== null) {
    const t = decodeXml(m[1] ?? '').trim();
    if (t) parts.push(t);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export async function extractPptx(buffer: Buffer): Promise<ExtractResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    throw new ExtractError('E_PARSE_FAILED', 'not a valid .pptx (could not open as OOXML zip)', err);
  }

  const slideNames: Array<{ name: string; n: number }> = [];
  const notesByN = new Map<number, string>();
  for (const name of Object.keys(zip.files)) {
    const s = SLIDE_RE.exec(name);
    if (s) {
      slideNames.push({ name, n: parseInt(s[1] ?? '0', 10) });
      continue;
    }
    const nt = NOTES_RE.exec(name);
    if (nt) notesByN.set(parseInt(nt[1] ?? '0', 10), name);
  }

  if (slideNames.length === 0) {
    throw new ExtractError('E_PARSE_FAILED', 'no slides found (is this a legacy .ppt? only .pptx is supported)');
  }
  slideNames.sort((a, b) => a.n - b.n);

  const slides: Array<{ index: number; text: string }> = [];
  const blocks: string[] = [];
  for (let i = 0; i < slideNames.length; i++) {
    const sf = slideNames[i];
    const xml = await zip.files[sf.name].async('string');
    let text = runsFrom(xml);
    // Fold in speaker notes for this slide, if any (matched by slide number).
    const notesName = notesByN.get(sf.n);
    if (notesName) {
      const notesText = runsFrom(await zip.files[notesName].async('string'));
      if (notesText) text = text ? `${text}\nNotes: ${notesText}` : `Notes: ${notesText}`;
    }
    slides.push({ index: i + 1, text });
    if (text) blocks.push(`# Slide ${i + 1}\n${text}`);
  }

  return {
    text: blocks.join('\n\n'),
    meta: { kind: 'pptx', slideCount: slides.length, slides },
  };
}
