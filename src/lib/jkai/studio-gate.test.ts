import { describe, it, expect } from 'vitest';
import { parseGateOutput, describeGate } from './studio-gate';

describe('parseGateOutput', () => {
  it('reads a clean pass', () => {
    const r = parseGateOutput('{"ran":true,"passed":true,"findings":[]}', '');
    expect(r).toEqual({ ran: true, passed: true, findings: [] });
  });

  it('reads findings', () => {
    const r = parseGateOutput(
      '{"ran":true,"passed":false,"findings":[{"chapter":2,"rule":"prose-only","message":"m","remedy":"r"}]}',
      '',
    );
    expect(r.ran).toBe(true);
    if (r.ran) {
      expect(r.passed).toBe(false);
      expect(r.findings[0].remedy).toBe('r');
    }
  });

  it('tolerates npm noise before the JSON', () => {
    const r = parseGateOutput('npm warn whatever\n{"ran":true,"passed":true,"findings":[]}', '');
    expect(r.ran).toBe(true);
  });

  // The contract inherited from static-smoke.ts. A harness that could not run
  // must never be reported as a failing app.
  it('turns unparseable output into ran:false, never passed:false', () => {
    expect(parseGateOutput('total garbage', '')).toEqual({
      ran: false,
      reason: 'total garbage',
    });
  });

  it('turns empty output into ran:false with the stderr as the reason', () => {
    const r = parseGateOutput('', 'Error: chromium missing');
    expect(r).toEqual({ ran: false, reason: 'Error: chromium missing' });
  });
});

describe('describeGate', () => {
  it('says skipped, not failed, when the harness did not run', () => {
    const s = describeGate({ ran: false, reason: 'no chromium' });
    expect(s).toMatch(/skipped/i);
    expect(s).not.toMatch(/failed/i);
  });

  it('includes the remedy so the next iteration knows what to do', () => {
    const s = describeGate({
      ran: true, passed: false,
      findings: [{ chapter: 2, rule: 'prose-only', message: 'Chapter 2 renders no canvas or svg.', remedy: 'Add a kit visual.' }],
    });
    expect(s).toContain('Chapter 2 renders no canvas or svg.');
    expect(s).toContain('Add a kit visual.');
  });
});
