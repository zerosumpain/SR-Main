import { describe, it, expect } from 'vitest';
import { parseSmokeOutput, describeSmoke } from './static-smoke';

/**
 * The distinction the whole feature rests on: "the app is broken" and "the
 * harness could not run" must never be confused. A harness fault reported as an
 * app failure would block good work and teach the model to route around the
 * tool — which is exactly how one 2026-08-08 conversation ended up hand-editing
 * a scratch file in /tmp that reached neither the build nor the site.
 */
describe('parseSmokeOutput', () => {
  it('reads a passing run', () => {
    const out = parseSmokeOutput(
      JSON.stringify({ ran: true, passed: true, checks: [{ name: 'adds up', passed: true }], failures: [] }),
      '',
    );
    expect(out).toEqual({ ran: true, passed: true, checks: [{ name: 'adds up', passed: true }], failures: [] });
  });

  it('reads a failing run and keeps the failure text', () => {
    const out = parseSmokeOutput(
      JSON.stringify({
        ran: true,
        passed: false,
        checks: [{ name: '7+8 is 15', passed: false, detail: 'returned "0"' }],
        failures: ['7+8 is 15 — returned "0"'],
      }),
      '',
    );
    expect(out).toMatchObject({ ran: true, passed: false });
    expect((out as { failures: string[] }).failures[0]).toContain('returned "0"');
  });

  it('treats a missing harness as not-run, never as a failing app', () => {
    const out = parseSmokeOutput(
      JSON.stringify({ ran: false, reason: 'playwright is not available in this environment' }),
      '',
    );
    expect(out.ran).toBe(false);
    expect(out).not.toHaveProperty('passed');
  });

  it('treats unreadable output as not-run', () => {
    expect(parseSmokeOutput('Segmentation fault', '').ran).toBe(false);
    expect(parseSmokeOutput('', 'node: command not found').ran).toBe(false);
    expect(parseSmokeOutput('{"ran": true, "passed"', '').ran).toBe(false);
  });

  it('survives noise printed before the JSON', () => {
    const out = parseSmokeOutput(
      'npm notice something\n{"ran":true,"passed":true,"checks":[],"failures":[]}',
      '',
    );
    expect(out).toMatchObject({ ran: true, passed: true });
  });

  it('carries stderr into the reason when stdout is empty', () => {
    const out = parseSmokeOutput('', 'Cannot find module playwright');
    expect(out).toMatchObject({ ran: false });
    expect((out as { reason: string }).reason).toContain('playwright');
  });
});

describe('describeSmoke', () => {
  it('says why it was skipped', () => {
    expect(describeSmoke({ ran: false, reason: 'playwright is not available' })).toBe(
      'Smoke test skipped — playwright is not available',
    );
  });

  it('lists every failure, because that list is what the model iterates on', () => {
    const text = describeSmoke({
      ran: true,
      passed: false,
      checks: [
        { name: 'loads', passed: true },
        { name: '7+8 is 15', passed: false },
      ],
      failures: ['7+8 is 15 — returned "0"'],
    });
    expect(text).toContain('FAILED');
    expect(text).toContain('1 of 2');
    expect(text).toContain('7+8 is 15 — returned "0"');
  });

  it('is quiet when everything is green', () => {
    expect(
      describeSmoke({ ran: true, passed: true, checks: [{ name: 'loads', passed: true }], failures: [] }),
    ).toBe('Smoke test passed — 1 check, all green.');
  });
});
