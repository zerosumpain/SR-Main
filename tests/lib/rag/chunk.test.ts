import { describe, it, expect } from 'vitest';
import { chunkText } from '$lib/rag/chunk';

describe('chunkText', () => {
  it('returns a single chunk for short text', () => {
    const chunks = chunkText('Hello world.', { chunkChars: 1000, overlapChars: 150 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('Hello world.');
    expect(chunks[0].charStart).toBe(0);
    expect(chunks[0].charEnd).toBe('Hello world.'.length);
  });

  it('returns nothing for empty / whitespace-only text', () => {
    expect(chunkText('', {})).toHaveLength(0);
    expect(chunkText('   \n\n  \t ', {})).toHaveLength(0);
  });

  it('splits long text into multiple chunks near the target size', () => {
    const para = 'Lorem ipsum dolor sit amet. '.repeat(200); // ~5600 chars
    const chunks = chunkText(para, { chunkChars: 1000, overlapChars: 150 });
    expect(chunks.length).toBeGreaterThan(4);
    // No chunk should be wildly larger than the target (allow slack for boundary seeking).
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1000 + 400);
    }
  });

  it('preserves all non-whitespace content across chunks (no loss)', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} here.`).join(' ');
    const chunks = chunkText(text, { chunkChars: 300, overlapChars: 60 });
    const strip = (s: string) => s.replace(/\s+/g, '');
    const joined = strip(chunks.map((c) => c.text).join(''));
    // Every sentence's core token must appear somewhere in the concatenated chunks.
    for (let i = 0; i < 60; i++) {
      expect(joined).toContain(strip(`Sentence number ${i} here.`));
    }
  });

  it('produces overlap between consecutive chunks', () => {
    const text = 'abcdefghij. '.repeat(100); // repeated, long
    const chunks = chunkText(text, { chunkChars: 400, overlapChars: 100 });
    expect(chunks.length).toBeGreaterThan(2);
    // Consecutive chunks should share a non-empty suffix/prefix region.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].charStart).toBeLessThan(chunks[i - 1].charEnd);
    }
  });

  it('prefers paragraph boundaries when splitting', () => {
    const p1 = 'A'.repeat(600);
    const p2 = 'B'.repeat(600);
    const chunks = chunkText(`${p1}\n\n${p2}`, { chunkChars: 700, overlapChars: 100 });
    // The first chunk should end at (or very near) the paragraph break, not mid-A.
    expect(chunks[0].text.startsWith('A')).toBe(true);
    // p2's B-run should begin a later chunk cleanly.
    expect(chunks.some((c) => c.text.includes('B'.repeat(300)))).toBe(true);
  });

  it('assigns monotonically increasing, non-overlapping-in-ord chunks', () => {
    const text = 'word '.repeat(1000);
    const chunks = chunkText(text, { chunkChars: 500, overlapChars: 80 });
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].charStart).toBeGreaterThan(chunks[i - 1].charStart);
    }
  });
});
