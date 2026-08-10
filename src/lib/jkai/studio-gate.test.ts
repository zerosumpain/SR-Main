import { describe, it, expect } from 'vitest';
import { parseGateOutput, describeGate, describeGateSkip } from './studio-gate';

describe('parseGateOutput', () => {
  it('reads a clean pass', () => {
    const r = parseGateOutput('{"ran":true,"passed":true,"findings":[]}', '');
    // notYetDue is always present now — chapters the plan says are not due yet,
    // skipped rather than reported as broken.
    expect(r).toEqual({ ran: true, passed: true, findings: [], notYetDue: [] });
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

describe('not-yet-due chapters', () => {
  // Before chaptersDue existed the gate reported every unbuilt chapter as
  // prose-only + no-model + uncited on EVERY iteration — three findings each
  // for work the agent was not yet meant to have done, drowning the real ones.
  it('carries notYetDue through the parse', () => {
    const r = parseGateOutput('{"ran":true,"passed":true,"findings":[],"notYetDue":[3,4]}', '');
    expect(r.ran).toBe(true);
    if (r.ran) expect(r.notYetDue).toEqual([3, 4]);
  });

  it('defaults notYetDue to empty when the runner omits it', () => {
    const r = parseGateOutput('{"ran":true,"passed":true,"findings":[]}', '');
    if (r.ran) expect(r.notYetDue).toEqual([]);
  });

  // Silence about a skipped check reads as a pass. The summary must say so.
  it('says how many chapters were skipped, on both pass and fail', () => {
    expect(describeGate({ ran: true, passed: true, findings: [], notYetDue: [3, 4] })).toContain('not yet due: 3, 4');
    expect(
      describeGate({
        ran: true, passed: false, notYetDue: [4],
        findings: [{ chapter: 2, rule: 'still-placeholder', message: 'm', remedy: 'r' }],
      }),
    ).toContain('not yet due: 4');
  });

  it('says nothing extra when every chapter was due', () => {
    expect(describeGate({ ran: true, passed: true, findings: [], notYetDue: [] })).not.toContain('not yet due');
  });
});
