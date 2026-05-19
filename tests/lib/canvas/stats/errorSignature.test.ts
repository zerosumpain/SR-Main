import { describe, it, expect } from 'vitest';
import { extractSignature } from '$lib/canvas/stats/errorSignature';

describe('extractSignature', () => {
  it('returns trimmed error for short input', () => {
    expect(extractSignature('  boom  ')).toBe('boom');
  });

  it('strips ANSI colour escape codes', () => {
    expect(extractSignature('\x1b[31mboom\x1b[0m')).toBe('boom');
  });

  it('strips a leading ISO timestamp prefix', () => {
    expect(
      extractSignature('2026-05-19T10:00:00.000Z error: bad thing'),
    ).toBe('error: bad thing');
  });

  it('strips a leading log-level prefix', () => {
    expect(extractSignature('ERROR: bad thing')).toBe('bad thing');
    expect(extractSignature('[error] bad thing')).toBe('bad thing');
    expect(extractSignature('WARN bad thing')).toBe('bad thing');
  });

  it('collapses internal whitespace', () => {
    expect(extractSignature('bad\n\n  thing')).toBe('bad thing');
  });

  it('truncates to 80 chars', () => {
    const long = 'x'.repeat(200);
    expect(extractSignature(long)).toHaveLength(80);
  });

  it('returns empty string for null/undefined/whitespace input', () => {
    expect(extractSignature('')).toBe('');
    expect(extractSignature('   ')).toBe('');
    // @ts-expect-error — runtime callers may pass null
    expect(extractSignature(null)).toBe('');
  });
});
