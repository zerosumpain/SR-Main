import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { extractText, kindFromMime } from '$lib/jkai/extract';

// Build a minimal-but-valid .pptx (OOXML zip) in memory: two slides of text
// plus a speaker-notes part, so the test needs no committed binary fixture.
function slideXml(...runs: string[]): string {
  const body = runs.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('');
  return `<?xml version="1.0"?><p:sld xmlns:a="urn:a" xmlns:p="urn:p"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
}

async function makePptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>');
  // Add slides out of order to prove the extractor sorts by slide number.
  zip.file('ppt/slides/slide2.xml', slideXml('Second slide about gallium cooling', 'eighteen channels'));
  zip.file('ppt/slides/slide1.xml', slideXml('Zephyr Reactor Overview', 'core temperature 4200 kelvin'));
  zip.file('ppt/notesSlides/notesSlide1.xml', slideXml('Presenter reminder: mention Dr Valdgren'));
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('pptx extraction', () => {
  it('kindFromMime recognises pptx by mime and extension', () => {
    expect(kindFromMime('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'x.pptx')).toBe('pptx');
    expect(kindFromMime('application/octet-stream', 'deck.pptx')).toBe('pptx');
    expect(kindFromMime('application/zip', 'deck.pptx')).toBe('pptx'); // extension wins
  });

  it('extracts slide text in slide order, with notes, and chunkable output', async () => {
    const buf = await makePptx();
    const res = await extractText(buf, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'deck.pptx');
    expect(res.meta.kind).toBe('pptx');
    // Slide 1 content must appear before slide 2 content (ordering).
    const i1 = res.text.indexOf('Zephyr Reactor Overview');
    const i2 = res.text.indexOf('Second slide about gallium');
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1);
    // Runs within a slide are joined.
    expect(res.text).toContain('core temperature 4200 kelvin');
    // Speaker notes are folded in.
    expect(res.text).toContain('Valdgren');
    // Slide markers present.
    expect(res.text).toContain('# Slide 1');
    expect(res.text).toContain('# Slide 2');
  });

  it('throws a clear error on a non-pptx / legacy .ppt', async () => {
    // A zip with no slides (e.g. a stray zip renamed .pptx) → clear failure.
    const zip = new JSZip();
    zip.file('random.txt', 'not a presentation');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(
      extractText(buf, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'x.pptx'),
    ).rejects.toThrow(/no slides|legacy/i);
  });
});
