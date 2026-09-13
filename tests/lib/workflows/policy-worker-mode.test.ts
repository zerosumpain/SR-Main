import { describe, expect, it } from 'vitest';
import { webWorkerOptions } from '../../../src/lib/workflows/policy-worker-mode';

describe('Main worker ownership after Policy extraction', () => {
  it('never starts a policy worker with missing or legacy settings', () => {
    for (const env of [{}, { POLICY_ANALYSIS_WORKER: '1' },
      { POLICY_ANALYSIS_WORKER_MODE: 'web' }, { POLICY_ANALYSIS_WORKER_MODE: 'external' }]) {
      expect(webWorkerOptions(true, env)).toBeNull();
      expect(webWorkerOptions(false, env)).toBeNull();
    }
  });
  it('starts general workflow execution only when both flags enable it', () => {
    expect(webWorkerOptions(true, { JKAI_RUN_WORKER: '1' })).toBeNull();
    expect(webWorkerOptions(true, { JKAI_RUN_WORKER_IN_WEB: '1' })).toBeNull();
    expect(webWorkerOptions(false, { JKAI_RUN_WORKER: '1', JKAI_RUN_WORKER_IN_WEB: '1' })).toEqual({});
  });
});
