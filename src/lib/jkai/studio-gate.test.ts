import { describe, it, expect } from 'vitest';
import { parseGateOutput, describeGate, describeGateSkip } from './studio-gate';

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

/**
 * The orchestrator used to guard the gate on
 * `chapterPlan.length > 0 && serve?.port` and, when either was falsy, do
 * nothing and log nothing. A studio build could therefore run to completion
 * with no chapter spine, no gate, and a log that read perfectly healthy — which
 * is precisely how SEAM-1's empty spine stayed invisible.
 */
describe('describeGateSkip', () => {
  it('returns null when the gate can actually run', () => {
    expect(describeGateSkip(6, 8123)).toBeNull();
  });

  it('names an empty chapter spine and points at the missing plan table', () => {
    const s = describeGateSkip(0, 8123)!;
    expect(s).toMatch(/SKIPPED/);
    expect(s).toMatch(/chapter spine is empty/);
    expect(s).toMatch(/Chapter Plan table/);
  });

  it('names a missing serving port', () => {
    const s = describeGateSkip(6, undefined)!;
    expect(s).toMatch(/no serving port/);
    expect(s).toMatch(/preview server never came up healthy/);
  });

  it('names both when both are missing', () => {
    const s = describeGateSkip(0, null)!;
    expect(s).toMatch(/chapter spine is empty AND no serving port/);
  });

  it('treats port 0 as no port', () => {
    expect(describeGateSkip(6, 0)).not.toBeNull();
  });

  it('says what stops being checked, so the line is actionable', () => {
    const s = describeGateSkip(0, 8123)!;
    expect(s).toMatch(/Nothing is checking this build's chapters/);
    expect(s).toMatch(/citation/);
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
