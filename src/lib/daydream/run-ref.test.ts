import { describe, expect, it } from 'vitest';
import { readRunRef, runIdFromHash, runRef, runRefHref } from './run-ref';

describe('runRefHref', () => {
  it('reads the new runRef shape', () => {
    const details = { runId: 'abc', runRef: runRef('doctor', 'abc') };
    expect(runRefHref(details, 'daydream-doctor')).toBe('/jkai/develop/doctor#run-abc');
    // The ref names its own ledger — the activity name is not needed.
    expect(runRefHref({ runRef: runRef('improvement', 'r1') })).toBe('/jkai/daydreams/improvement#run-r1');
  });

  it('infers the kind from the activity for the old runId-only shape', () => {
    expect(runRefHref({ runId: 'r2' }, 'daydream-improve')).toBe('/jkai/daydreams/improvement#run-r2');
    expect(runRefHref({ runId: 'r3' }, 'daydream-doctor')).toBe('/jkai/develop/doctor#run-r3');
  });

  it('returns null when nothing names a run', () => {
    expect(runRefHref(null, 'daydream-improve')).toBeNull();
    expect(runRefHref(undefined)).toBeNull();
    expect(runRefHref({ status: 'ok' }, 'daydream-improve')).toBeNull();
    // A runId on an activity that has no ledger is not guessed at.
    expect(runRefHref({ runId: 'x' }, 'daydream-ponder')).toBeNull();
    expect(runRefHref({ runId: 'x' })).toBeNull();
  });

  it('ignores a malformed runRef and falls back to runId', () => {
    expect(readRunRef({ runRef: { kind: 'build', id: 'b' }, runId: 'r4' }, 'daydream-doctor')).toEqual({
      kind: 'doctor',
      id: 'r4',
    });
    expect(readRunRef({ runRef: { kind: 'doctor', id: '' } })).toBeNull();
  });
});

describe('runIdFromHash', () => {
  it('round-trips an href fragment', () => {
    const href = runRefHref({ runRef: runRef('doctor', 'a b') })!;
    expect(runIdFromHash(href.slice(href.indexOf('#')))).toBe('a b');
  });
  it('returns null for other fragments', () => {
    expect(runIdFromHash('')).toBeNull();
    expect(runIdFromHash('#overnight')).toBeNull();
    expect(runIdFromHash('#run-')).toBeNull();
    expect(runIdFromHash('#run-%E0%A4%A')).toBeNull();
  });
});
