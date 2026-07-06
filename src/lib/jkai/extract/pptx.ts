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
const PARA_RE = /<a:p\b[\s\S]*?<\/a:p>/g;

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&'); // last, so decoded entities aren't re-decoded
}

/** Re-escape decoded text so it is safe to embed in generated HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

/**
 * Split a slide/notes XML into paragraph lines (`<a:p>` blocks), each the runs of
 * that paragraph joined. Gives the rich renderer bullet-level structure instead of
 * one flat blob. Empty paragraphs are dropped.
 */
function paragraphsFrom(xml: string): string[] {
  const lines: string[] = [];
  PARA_RE.lastIndex = 0;
  let p: RegExpExecArray | null;
  while ((p = PARA_RE.exec(xml)) !== null) {
    const line = runsFrom(p[0] ?? '');
    if (line) lines.push(line);
  }
  // Fallback: a slide with no <a:p> structure (unusual) still yields its runs.
  if (lines.length === 0) {
    const flat = runsFrom(xml);
    if (flat) lines.push(flat);
  }
  return lines;
}

/**
 * Build a rich slide card: the first paragraph as the slide title, remaining
 * paragraphs as a bullet list, plus speaker notes. All text is escaped.
 */
function slideHtml(index: number, paras: string[], notes: string[]): string {
  const title = paras[0] ? `<h3 class="pptx-title">${escapeHtml(paras[0])}</h3>` : '';
  const body =
    paras.length > 1
      ? `<ul class="pptx-body">${paras.slice(1).map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
      : '';
  const notesHtml =
    notes.length > 0
      ? `<div class="pptx-notes"><span class="pptx-notes-label">Notes</span>${notes
          .map((n) => `<p>${escapeHtml(n)}</p>`)
          .join('')}</div>`
      : '';
  return `<section class="pptx-slide"><div class="pptx-slide-no">Slide ${index}</div>${title}${body}${notesHtml}</section>`;
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
  const cards: string[] = [];
  for (let i = 0; i < slideNames.length; i++) {
    const sf = slideNames[i];
    const xml = await zip.files[sf.name].async('string');
    let text = runsFrom(xml);
    const paras = paragraphsFrom(xml);
    // Fold in speaker notes for this slide, if any (matched by slide number).
    const notesLines: string[] = [];
    const notesName = notesByN.get(sf.n);
    if (notesName) {
      const notesXml = await zip.files[notesName].async('string');
      const notesText = runsFrom(notesXml);
      if (notesText) {
        text = text ? `${text}\nNotes: ${notesText}` : `Notes: ${notesText}`;
        notesLines.push(...paragraphsFrom(notesXml));
      }
    }
    slides.push({ index: i + 1, text });
    if (text) blocks.push(`# Slide ${i + 1}\n${text}`);
    cards.push(slideHtml(i + 1, paras, notesLines));
  }

  return {
    text: blocks.join('\n\n'),
    html: `<div class="pptx-deck">${cards.join('')}</div>`,
    meta: { kind: 'pptx', slideCount: slides.length, slides },
  };
}
