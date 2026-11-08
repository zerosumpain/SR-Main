import { describe, expect, it, vi, beforeEach } from 'vitest';

// The wire half of SR-Workflows' doctor operations (its runtime-invoke.ts
// schema is strict, so a stray field would be a refused request).
const invoke = vi.fn(async (_args: unknown) => ({ status: 200, body: {} }));
vi.mock('./runtime-client', () => ({ invokeWorkflowRuntime: (a: unknown) => invoke(a) }));

import { actOnDoctorFinding, doctorOverview, requestDoctorRun, setDoctorSwitches } from './doctor-client';

beforeEach(() => invoke.mockClear());

describe('doctor client', () => {
  it('names each operation on the owner runtime lane', async () => {
    await doctorOverview();
    await requestDoctorRun();
    expect(invoke.mock.calls.map((c) => c[0])).toEqual([{ action: 'doctor_overview' }, { action: 'doctor_run' }]);
  });

  it('sends only the switches that were given', async () => {
    await setDoctorSwitches({ enabled: undefined, autoApply: true, breaker: undefined });
    expect(invoke).toHaveBeenCalledWith({ action: 'doctor_toggle', autoApply: true });
  });

  it('keeps the finding verb apart from the operation name', async () => {
    await actOnDoctorFinding('w:n:abc', 'revert');
    expect(invoke).toHaveBeenCalledWith({ action: 'doctor_finding', key: 'w:n:abc', doctorAction: 'revert' });
  });
});
