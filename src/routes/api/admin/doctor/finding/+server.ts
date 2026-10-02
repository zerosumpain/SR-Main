import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { actOnDoctorFinding } from '$lib/workflows-client/doctor-client';

// Owner-only (enforced in hooks.server.ts for /api/admin/*). A verdict
// (`accept` / `dismiss`, both sticky) or an undo (`revert`) on one doctor
// finding. SR-Workflows owns the findings and the canvases a revert writes to
// since 2026-10-02; it validates the request, takes the versioned revert path
// and answers 400/404/409/422 exactly as this route used to. Never retried: a
// revert is a mutation.
const ACTIONS = ['accept', 'dismiss', 'revert'];

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { key?: unknown; action?: unknown };
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!key) return json({ error: '`key` is required' }, { status: 400 });
  // Checked here too so a malformed request is a 400, not a failed runtime call.
  if (typeof body.action !== 'string' || !ACTIONS.includes(body.action)) {
    return json({ error: `\`action\` must be one of: ${ACTIONS.join(', ')}` }, { status: 400 });
  }
  try {
    const { status, body: out } = await actOnDoctorFinding(key, body.action);
    return json(out, { status });
  } catch (err) {
    console.error('[workflowdoctor] finding action failed:', err instanceof Error ? err.message : err);
    return json({ error: 'The workflow doctor could not be reached.' }, { status: 502 });
  }
};
