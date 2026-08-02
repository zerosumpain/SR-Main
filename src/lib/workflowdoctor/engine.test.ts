import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable host name for the prod-gate test, plus the captured cron callback.
const h = vi.hoisted(() => ({
  host: 'vps-prod' as string,
  cb: null as null | (() => void),
}));

vi.mock('os', () => ({ default: { hostname: () => h.host } }));

// Croner: capture whether a cron was scheduled (must be `new`-able) and keep
// the callback so fireCron's gates can be exercised without waiting for 05:00.
const cronCtor = vi.hoisted(() =>
  vi.fn(function MockCron(_expr: string, _opts: unknown, fn: () => void) {
    h.cb = fn;
    return { stop: () => {} };
  }),
);
vi.mock('croner', () => ({ Cron: cronCtor }));

// Isolate the pipeline, the seed and the gates so startWorkflowDoctor only
// exercises seeding + scheduling.
vi.mock('./run', () => ({ runDoctorNow: vi.fn().mockResolvedValue({ runId: 'r1' }) }));
vi.mock('./findings', () => ({ ensureDoctorCollections: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$lib/selfimprove/run', () => ({ isUserActive: vi.fn().mockResolvedValue(false) }));
vi.mock('$lib/server/models/settings', () => ({ getSetting: vi.fn().mockResolvedValue(null) }));

import { getSetting } from '$lib/server/models/settings';
import { isUserActive } from '$lib/selfimprove/run';
import { runDoctorNow } from './run';
import { ensureDoctorCollections } from './findings';
import { startWorkflowDoctor, stopWorkflowDoctor, isDoctorScheduled } from './engine';

/** Let the fire-and-forget cron callback settle. */
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureDoctorCollections).mockResolvedValue(undefined as never);
  vi.mocked(isUserActive).mockResolvedValue(false as never);
  vi.mocked(getSetting).mockResolvedValue(null as never);
  vi.mocked(runDoctorNow).mockResolvedValue({ runId: 'r1' } as never);
  cronCtor.mockImplementation(function MockCron(_expr: string, _opts: unknown, fn: () => void) {
    h.cb = fn;
    return { stop: () => {} };
  });
  h.host = 'vps-prod';
  h.cb = null;
  delete process.env.WORKFLOW_DOCTOR_ALLOW_DEV;
  // Clears the module `started` latch so each test arms from scratch.
  stopWorkflowDoctor();
});

describe('startWorkflowDoctor — prod host gate', () => {
  it('does NOT schedule the cron on homeserv without the dev override', () => {
    h.host = 'homeserv';
    startWorkflowDoctor();
    expect(cronCtor).not.toHaveBeenCalled();
    expect(isDoctorScheduled()).toBe(false);
  });

  it('schedules the nightly cron on a production (non-homeserv) host', () => {
    h.host = 'vps-prod';
    startWorkflowDoctor();
    expect(cronCtor).toHaveBeenCalledTimes(1);
    expect(isDoctorScheduled()).toBe(true);
    stopWorkflowDoctor();
  });

  it('schedules on homeserv when WORKFLOW_DOCTOR_ALLOW_DEV=1', () => {
    h.host = 'homeserv';
    process.env.WORKFLOW_DOCTOR_ALLOW_DEV = '1';
    startWorkflowDoctor();
    expect(cronCtor).toHaveBeenCalledTimes(1);
    expect(isDoctorScheduled()).toBe(true);
    stopWorkflowDoctor();
  });

  it('seeds the collections on homeserv too — the page works where the cron does not', () => {
    h.host = 'homeserv';
    startWorkflowDoctor();
    expect(ensureDoctorCollections).toHaveBeenCalledTimes(1);
    expect(cronCtor).not.toHaveBeenCalled();
  });

  it('is idempotent — a second call neither re-seeds nor re-schedules', () => {
    startWorkflowDoctor();
    startWorkflowDoctor();
    expect(cronCtor).toHaveBeenCalledTimes(1);
    expect(ensureDoctorCollections).toHaveBeenCalledTimes(1);
    stopWorkflowDoctor();
  });

  it('survives a croner throw without leaving the engine half-armed', () => {
    cronCtor.mockImplementation(() => {
      throw new Error('bad expression');
    });
    expect(() => startWorkflowDoctor()).not.toThrow();
    expect(isDoctorScheduled()).toBe(false);
  });
});

describe('fireCron — kill switch + idle gate', () => {
  it('runs the pipeline when the switch is unset and the user is idle', async () => {
    startWorkflowDoctor();
    h.cb?.();
    await vi.waitFor(() => expect(runDoctorNow).toHaveBeenCalledWith({ trigger: 'cron' }));
    stopWorkflowDoctor();
  });

  it('skips when the kill switch is explicitly false', async () => {
    vi.mocked(getSetting).mockResolvedValue(false as never);
    startWorkflowDoctor();
    h.cb?.();
    await tick();
    expect(runDoctorNow).not.toHaveBeenCalled();
    stopWorkflowDoctor();
  });

  it('skips when the user was active in the last hour', async () => {
    vi.mocked(isUserActive).mockResolvedValue(true as never);
    startWorkflowDoctor();
    h.cb?.();
    await tick();
    expect(runDoctorNow).not.toHaveBeenCalled();
    stopWorkflowDoctor();
  });

  it('never throws into croner when the run rejects (the overlap guard does)', async () => {
    vi.mocked(runDoctorNow).mockRejectedValue(new Error('a workflow doctor run is already in progress') as never);
    startWorkflowDoctor();
    expect(() => h.cb?.()).not.toThrow();
    await tick();
    stopWorkflowDoctor();
  });
});
