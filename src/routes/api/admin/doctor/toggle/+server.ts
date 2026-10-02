import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setDoctorSwitches } from '$lib/workflows-client/doctor-client';

// Owner-only (enforced in hooks.server.ts for /api/admin/*). The doctor's three
// switches — `enabled` (unset = ON), `breaker` (unset = ON) and `autoApply`
// (unset = OFF; only an explicit `true` arms it). SR-Workflows owns them since
// the doctor moved there on 2026-10-02, and refuses a non-boolean with a 400
// rather than coercing it: `{ enabled: 'false' }` must never read as ON.
export const POST: RequestHandler = async ({ request }) => {
  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown> | null;
  const body = raw && typeof raw === 'object' ? raw : {};
  try {
    const result = await setDoctorSwitches({ enabled: body.enabled, autoApply: body.autoApply, breaker: body.breaker });
    return json(result.body, { status: result.status });
  } catch (err) {
    console.error('[workflowdoctor] switch update failed:', err instanceof Error ? err.message : err);
    return json({ error: 'The workflow doctor could not be reached.' }, { status: 502 });
  }
};
