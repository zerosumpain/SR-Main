import { describe, expect, it } from 'vitest';
import { policyWorkerMode, webWorkerOptions } from '../../../src/lib/workflows/policy-worker-mode';

describe('policy worker handover', () => {
  it('keeps existing web policy execution until explicitly handed over', () => {
    expect(policyWorkerMode({})).toBe('web');
    expect(webWorkerOptions(true, {})).toEqual({ policyOnly: true });
    expect(webWorkerOptions(false, {})).toBeNull();
    expect(webWorkerOptions(false, { POLICY_ANALYSIS_WORKER: '1' })).toEqual({ policyOnly: true });
  });
  it('prevents legacy preview flags from overriding external ownership', () => {
    expect(webWorkerOptions(true, { POLICY_ANALYSIS_WORKER_MODE: 'external', POLICY_ANALYSIS_WORKER: '1' })).toBeNull();
  });
  it('keeps explicitly enabled general workflow execution during handover', () => {
    expect(webWorkerOptions(true, { POLICY_ANALYSIS_WORKER_MODE: 'external', JKAI_RUN_WORKER: '1', JKAI_RUN_WORKER_IN_WEB: '1' })).toEqual({});
    expect(webWorkerOptions(true, { POLICY_ANALYSIS_ENABLED: '0', JKAI_RUN_WORKER: '1', JKAI_RUN_WORKER_IN_WEB: '1' })).toEqual({});
  });
  it('rejects misspelled modes and respects disabling policy execution', () => {
    expect(() => policyWorkerMode({ POLICY_ANALYSIS_WORKER_MODE: 'externl' })).toThrow();
    expect(webWorkerOptions(true, { POLICY_ANALYSIS_ENABLED: '0' })).toBeNull();
  });
});
