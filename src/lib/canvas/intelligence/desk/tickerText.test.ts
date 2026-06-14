// src/lib/canvas/intelligence/desk/tickerText.test.ts
import { describe, it, expect } from 'vitest';
import { tickerLine } from './tickerText';

describe('tickerLine', () => {
  it('returns an idle placeholder for an empty log', () => {
    expect(tickerLine([])).toMatch(/idle|waiting|stand/i);
  });

  it('strips the leading emoji + double-space that emitLog prepends', () => {
    // emitLog formats as `${icon}  ${message}`
    const out = tickerLine([{ message: '🔍  Searching: roman republic fall causes', timestamp: 1 }]);
    expect(out).toBe('Searching: roman republic fall causes');
  });

  it('uses the most recent log entry', () => {
    const out = tickerLine([
      { message: 'ℹ️  Starting Phase 1', timestamp: 1 },
      { message: '🔍  Extracting facts from source 4', timestamp: 2 },
    ]);
    expect(out).toBe('Extracting facts from source 4');
  });

  it('collapses internal whitespace and trims', () => {
    const out = tickerLine([{ message: '⚠️   Phase 2   error:   timeout  ', timestamp: 1 }]);
    expect(out).toBe('Phase 2 error: timeout');
  });

  it('leaves messages without a leading icon untouched (just trimmed)', () => {
    expect(tickerLine([{ message: 'Research complete!', timestamp: 1 }])).toBe('Research complete!');
  });
});
