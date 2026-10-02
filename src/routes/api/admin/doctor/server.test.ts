import { beforeEach, describe, expect, it, vi } from 'vitest';

// The owner's doctor controls forward to SR-Workflows, which owns the doctor
// since 2026-10-02, and relay its answer — status code included.
const h = vi.hoisted(() => ({
  requestDoctorRun: vi.fn(),
  setDoctorSwitches: vi.fn(),
  actOnDoctorFinding: vi.fn(),
}));
vi.mock('$lib/workflows/doctor-client', () => h);

import { POST as run } from './run/+server';
import { POST as toggle } from './toggle/+server';
import { POST as finding } from './finding/+server';

const req = (body?: unknown) =>
  ({ request: new Request('https://example.test/x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }) }) as never;

beforeEach(() => vi.clearAllMocks());

describe('POST /api/admin/doctor/run', () => {
  it('queues a run on the Workflows worker and relays its id', async () => {
    h.requestDoctorRun.mockResolvedValue({ status: 200, body: { ok: true, runId: 'r1', queued: true } });
    const res = await run(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, runId: 'r1', queued: true });
  });

  it('relays a 409 while one is already live', async () => {
    h.requestDoctorRun.mockResolvedValue({ status: 409, body: { error: 'A workflow doctor run is already in progress.' } });
    expect((await run(req())).status).toBe(409);
  });

  it('answers 502, never a local fallback, when SR-Workflows is unreachable', async () => {
    h.requestDoctorRun.mockRejectedValue(new Error('Workflows runtime unavailable'));
    expect((await run(req())).status).toBe(502);
  });
});

describe('POST /api/admin/doctor/toggle', () => {
  it('forwards only the switches, unchecked, so the owner can 400 a non-boolean', async () => {
    h.setDoctorSwitches.mockResolvedValue({ status: 400, body: { error: '`enabled` must be a boolean' } });
    const res = await toggle(req({ enabled: 'false', other: 1 }));
    expect(res.status).toBe(400);
    expect(h.setDoctorSwitches).toHaveBeenCalledWith({ enabled: 'false', autoApply: undefined, breaker: undefined });
  });

  it('relays an applied switch', async () => {
    h.setDoctorSwitches.mockResolvedValue({ status: 200, body: { ok: true, autoApply: true } });
    expect(await (await toggle(req({ autoApply: true }))).json()).toEqual({ ok: true, autoApply: true });
  });
});

describe('POST /api/admin/doctor/finding', () => {
  it('refuses a malformed request locally', async () => {
    expect((await finding(req({ action: 'accept' }))).status).toBe(400);
    expect((await finding(req({ key: 'k', action: 'delete' }))).status).toBe(400);
    expect(h.actOnDoctorFinding).not.toHaveBeenCalled();
  });

  it('relays a revert refusal from the owner', async () => {
    h.actOnDoctorFinding.mockResolvedValue({ status: 422, body: { error: 'credential', sensitiveFields: ['apiKey'] } });
    const res = await finding(req({ key: ' k ', action: 'revert' }));
    expect(res.status).toBe(422);
    expect(h.actOnDoctorFinding).toHaveBeenCalledWith('k', 'revert');
  });
});
