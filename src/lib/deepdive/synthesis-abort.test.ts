import { describe, it, expect, afterEach } from 'vitest';
import {
  registerSynthesisRun,
  getSynthesisSignal,
  requestStopSynthesis,
  clearSynthesisRun,
  isSynthesisAborted,
} from './synthesis-abort';

afterEach(() => {
  // Defensive cleanup so cross-test state never leaks.
  clearSynthesisRun('run-a');
  clearSynthesisRun('run-b');
});

describe('synthesis abort registry', () => {
  it('register then getSynthesisSignal returns a live, un-aborted signal', () => {
    registerSynthesisRun('run-a');
    const sig = getSynthesisSignal('run-a');
    expect(sig).toBeInstanceOf(AbortSignal);
    expect(sig!.aborted).toBe(false);
  });

  it('requestStopSynthesis aborts only the targeted run', () => {
    registerSynthesisRun('run-a');
    registerSynthesisRun('run-b');
    requestStopSynthesis('run-a');
    expect(getSynthesisSignal('run-a')!.aborted).toBe(true);
    expect(getSynthesisSignal('run-b')!.aborted).toBe(false);
  });

  it('isSynthesisAborted reflects state and is false for unknown runs', () => {
    registerSynthesisRun('run-a');
    expect(isSynthesisAborted('run-a')).toBe(false);
    requestStopSynthesis('run-a');
    expect(isSynthesisAborted('run-a')).toBe(true);
    expect(isSynthesisAborted('does-not-exist')).toBe(false);
  });

  it('getSynthesisSignal returns undefined for unknown run', () => {
    expect(getSynthesisSignal('nope')).toBeUndefined();
  });

  it('requestStopSynthesis on an unknown run is a no-op (no throw)', () => {
    expect(() => requestStopSynthesis('ghost')).not.toThrow();
  });

  it('clearSynthesisRun removes the controller', () => {
    registerSynthesisRun('run-a');
    clearSynthesisRun('run-a');
    expect(getSynthesisSignal('run-a')).toBeUndefined();
  });

  it('registering the same runId twice replaces the controller (fresh signal)', () => {
    registerSynthesisRun('run-a');
    requestStopSynthesis('run-a');
    expect(isSynthesisAborted('run-a')).toBe(true);
    registerSynthesisRun('run-a'); // re-register
    expect(isSynthesisAborted('run-a')).toBe(false);
  });
});
