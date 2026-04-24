import { describe, it, expect } from 'vitest';
import { extractMarkdown } from '../../src/lib/jkai/extract/markdown';

describe('markdown extractor', () => {
  it('strips markdown to plain text and captures headings', () => {
    const md = '# Title\n\nSome **bold** text.\n\n## Subsection\n\nA list:\n- one\n- two';
    const r = extractMarkdown(Buffer.from(md, 'utf8'));
    expect(r.text).toContain('Title');
    expect(r.text).toContain('Some bold text.');
    expect(r.text).toContain('one');
    expect(r.meta.kind).toBe('markdown');
    if (r.meta.kind !== 'markdown') throw new Error('wrong kind');
    expect(r.meta.headings).toEqual([
      { level: 1, text: 'Title' },
      { level: 2, text: 'Subsection' },
    ]);
  });
});
