import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import { parseGateOutput, describeGate, describeGateSkip } from './studio-gate';
// The runner is a standalone script (playwright resolves from the script's own
// directory), but the base-href transform is pure and importable. Its guarded
// entry point means importing it does not launch a browser.
import { injectBaseHref } from '../../../scripts/studio-gate.mjs';

// The fix that took build 85dac418 from 24 findings to 1. Both surfaces a
// reader reaches inject a <base href> at the project root, so the system
// prompt mandates project-root-relative URLs; the gate drove the bare server
// with no base tag, where those resolve against the chapter directory and
// 404. It then reported prose-only, no-model, no-design-tokens and no-scene
// about a page that was, everywhere anyone looks, fine.
describe('injectBaseHref', () => {
  const ROOT = 'http://127.0.0.1:4173/';

  it('puts the base tag directly after <head>, so it precedes every asset', () => {
    const html = '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body>x</body></html>';
    const out = injectBaseHref(html, ROOT);
    expect(out).toContain(`<head><base href="${ROOT}">`);
    // Order is load-bearing: a <base> after a <link> does not retarget it.
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<link'));
  });

  it('handles a head tag carrying attributes', () => {
    const out = injectBaseHref('<head lang="en"><title>t</title></head>', ROOT);
    expect(out).toContain(`<head lang="en"><base href="${ROOT}">`);
  });

  it('leaves a page that already declares its own base completely alone', () => {
    // Such a page is telling us where its root is; overriding it would be a
    // new lie rather than a fix.
    const html = '<head><base href="/projects/thing/"><title>t</title></head>';
    expect(injectBaseHref(html, ROOT)).toBe(html);
  });

  it('still injects when there is no head element at all', () => {
    expect(injectBaseHref('<p>fragment</p>', ROOT)).toBe(`<base href="${ROOT}"><p>fragment</p>`);
  });

  it('is case-insensitive about the head tag', () => {
    expect(injectBaseHref('<HEAD><title>t</title></HEAD>', ROOT)).toContain(`<HEAD><base href="${ROOT}">`);
  });
});

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

// Build 5443df54 passed this gate while serving one identical page at all seven
// chapter URLs: the per-chapter assertions ran against the whole document, so
// chapter 1's visual, lever and citation satisfied every other chapter. A
// browser is needed to test the behaviour, but the regression is a one-word
// edit — page.locator instead of root.locator — so guard the source directly.
describe('per-chapter checks stay scoped to the chapter', () => {
  it('uses root.locator, never page.locator, for visual/lever/outcome/citation', async () => {
    const src = await readFile('scripts/studio-gate.mjs', 'utf-8');
    for (const scoped of [
      "root.locator('canvas[data-scene], svg')",
      'root.locator(`[data-lever=',
      'root.locator(`[data-outcome=',
      "root.locator('a[data-citation]')",
    ]) {
      expect(src, `${scoped} must be scoped to the chapter root`).toContain(scoped);
    }
    // These four facts must never be asked of the whole document again.
    for (const unscoped of [
      "page.locator('canvas[data-scene], svg')",
      'page.locator(`[data-lever=',
      'page.locator(`[data-outcome=',
      "page.locator('a[data-citation]')",
    ]) {
      expect(src, `${unscoped} searches the whole page — scope it to the chapter`).not.toContain(unscoped);
    }
  });

  it('still checks the four project-wide rules', async () => {
    const src = await readFile('scripts/studio-gate.mjs', 'utf-8');
    for (const rule of ['chapters-not-distinct', 'broken-link', 'no-design-tokens', 'still-placeholder']) {
      expect(src).toContain(rule);
    }
  });
});

// runStudioGate accepted chaptersDue and dropped it from the payload between
// PR #193 and #195 — the fixture tests passed because they drove
// scripts/studio-gate.mjs DIRECTLY, never through this module. The runner
// defaults a missing chaptersDue to 0, which means "check every chapter",
// so the drop was invisible except as a wall of premature findings on a real
// build. Assert the wire format, not just the signature.
describe('the spec put on the wire', () => {
  it('carries every field the runner reads', async () => {
    const src = await readFile('src/lib/jkai/studio-gate.ts', 'utf-8');
    const payload = src.slice(src.indexOf('const payload = JSON.stringify('));
    const body = payload.slice(0, payload.indexOf('});') + 3);
    for (const field of ['chapters:', 'chaptersDue:', 'sourceUrls:', 'kitFiles:']) {
      expect(body, `${field} missing from the runner payload`).toContain(field);
    }
  });

  it('reads back every field it writes', async () => {
    const runner = await readFile('scripts/studio-gate.mjs', 'utf-8');
    for (const field of ['spec.chapters', 'spec.chaptersDue', 'spec.sourceUrls', 'spec.kitFiles']) {
      expect(runner, `${field} is sent but never read`).toContain(field);
    }
  });
});

// The orchestrator treats "gate passed AND nothing not-yet-due AND a non-empty
// chapter plan" as the definition of a finished studio build. Build f86342f9
// met that at iteration ~12 and nothing acted on it: the agent then reported
// "8/8 complete, nothing to do" three times, tripped the idle breaker, and a
// working explainer was recorded as failed. Pin the shape of the signal.
describe('studio completion signal', () => {
  const done = (over: Partial<{ passed: boolean; notYetDue: number[] }> = {}) => {
    const o = parseGateOutput(
      JSON.stringify({ ran: true, passed: true, findings: [], notYetDue: [], ...over }),
      '',
    );
    if (!o.ran) throw new Error('expected ran:true');
    return o.passed && (o.notYetDue?.length ?? 0) === 0;
  };

  it('is true when every planned chapter passed and none are pending', () => {
    expect(done()).toBe(true);
  });

  it('is false while chapters are still not due', () => {
    expect(done({ notYetDue: [7, 8] })).toBe(false);
  });

  it('is false when the gate found problems', () => {
    expect(done({ passed: false })).toBe(false);
  });
});
