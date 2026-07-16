import { describe, it, expect } from 'vitest';
import { markdownToWhatsApp, chunkMessage, WHATSAPP_MAX_CHARS } from '$lib/workflows/whatsapp/format';

describe('markdownToWhatsApp', () => {
  it('converts **bold** to *bold*', () => {
    expect(markdownToWhatsApp('a **strong** word')).toBe('a *strong* word');
  });

  it('converts __bold__ to *bold*', () => {
    expect(markdownToWhatsApp('a __strong__ word')).toBe('a *strong* word');
  });

  it('leaves _italic_ unchanged (WhatsApp uses the same glyph)', () => {
    expect(markdownToWhatsApp('an _emphasised_ word')).toBe('an _emphasised_ word');
  });

  it('turns ## headings into a bold line', () => {
    expect(markdownToWhatsApp('## Daily Headlines')).toBe('*Daily Headlines*');
    expect(markdownToWhatsApp('### Sub heading ###')).toBe('*Sub heading*');
  });

  it('rewrites [text](url) links to "text (url)"', () => {
    expect(markdownToWhatsApp('see [the report](https://x.com/r)')).toBe('see the report (https://x.com/r)');
  });

  it('rewrites image ![alt](url) to "alt (url)"', () => {
    expect(markdownToWhatsApp('![chart](https://x.com/c.png)')).toBe('chart (https://x.com/c.png)');
  });

  it('converts -, *, + bullets to •', () => {
    expect(markdownToWhatsApp('- one\n- two')).toBe('• one\n• two');
    expect(markdownToWhatsApp('* a\n+ b')).toBe('• a\n• b');
  });

  it('strips inline `code` backticks', () => {
    expect(markdownToWhatsApp('run `npm test` now')).toBe('run npm test now');
  });

  it('removes fenced code markers but keeps the content', () => {
    const out = markdownToWhatsApp('```js\nconst a = 1;\n```');
    expect(out).toContain('const a = 1;');
    expect(out).not.toContain('```');
  });

  it('handles a combined document', () => {
    const md = '## Report\n\nThis is **important**. See [docs](https://d.co).\n\n- item one\n- item two';
    const out = markdownToWhatsApp(md);
    expect(out).toContain('*Report*');
    expect(out).toContain('*important*');
    expect(out).toContain('docs (https://d.co)');
    expect(out).toContain('• item one');
    expect(out).not.toContain('**');
    expect(out).not.toContain('](');
  });

  it('returns empty string for empty input', () => {
    expect(markdownToWhatsApp('')).toBe('');
  });
});

describe('chunkMessage', () => {
  it('returns a single chunk when under the limit', () => {
    expect(chunkMessage('short message')).toEqual(['short message']);
  });

  it('returns a single chunk exactly at the limit', () => {
    const exact = 'x'.repeat(WHATSAPP_MAX_CHARS);
    expect(chunkMessage(exact)).toEqual([exact]);
  });

  it('splits on paragraph boundaries when over the limit', () => {
    const para = 'y'.repeat(3000);
    const text = `${para}\n\n${para}`; // 6002 chars, two 3000-char paragraphs
    const chunks = chunkMessage(text, 5);
    expect(chunks.length).toBe(2);
    expect(chunks.every((c) => c.length <= WHATSAPP_MAX_CHARS)).toBe(true);
    expect(chunks[0]).toBe(para);
    expect(chunks[1]).toBe(para);
  });

  it('hard-splits a single paragraph longer than the limit', () => {
    const big = 'z'.repeat(WHATSAPP_MAX_CHARS + 500);
    const chunks = chunkMessage(big, 5);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(WHATSAPP_MAX_CHARS);
    expect(chunks[1].length).toBe(500);
  });

  it('truncates and appends a marker beyond maxChunks', () => {
    const para = 'w'.repeat(3000);
    const text = [para, para, para, para].join('\n\n'); // would be 4 chunks
    const chunks = chunkMessage(text, 2);
    expect(chunks.length).toBe(2);
    expect(chunks[chunks.length - 1]).toContain('… (truncated)');
    expect(chunks.every((c) => c.length <= WHATSAPP_MAX_CHARS)).toBe(true);
  });

  it('does not cap when maxChunks is 0', () => {
    const para = 'q'.repeat(3000);
    const text = [para, para, para, para].join('\n\n');
    const chunks = chunkMessage(text, 0);
    expect(chunks.length).toBe(4);
    expect(chunks.join('')).not.toContain('truncated');
  });
});
