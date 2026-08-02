import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setSetting } from '$lib/server/models/settings';
import {
  SETTINGS_AUTOAPPLY_KEY,
  SETTINGS_BREAKER_KEY,
  SETTINGS_ENABLED_KEY,
} from '$lib/workflowdoctor/types';

// Owner-only (enforced in hooks.server.ts for /api/admin/*). The doctor's three
// switches, all in `app_settings`:
//
//   enabled   — nightly kill switch.      Unset = ON  (house idiom).
//   breaker   — runaway-schedule pauser.  Unset = ON  (writes one boolean on
//               workflow_schedules; never touches node config).
//   autoApply — node-config writer.       Unset = OFF. Only an explicit `true`
//               arms it, and the engine re-reads that on every run.
//
// One endpoint for all three so the page has one door; a body may carry any
// subset, and a key that is present but not a boolean is a 400 rather than a
// coerced write — `{ enabled: 'false' }` must never read as ON.

const FIELDS = [
  ['enabled', SETTINGS_ENABLED_KEY],
  ['autoApply', SETTINGS_AUTOAPPLY_KEY],
  ['breaker', SETTINGS_BREAKER_KEY],
] as const;

type Body = Partial<Record<(typeof FIELDS)[number][0], unknown>>;

/** POST { enabled?, autoApply?, breaker? } — set one or more switches. */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Body;

  const wanted = FIELDS.filter(([field]) => body[field] !== undefined);
  if (wanted.length === 0) {
    return json(
      { error: 'Provide at least one of `enabled`, `autoApply`, `breaker`' },
      { status: 400 },
    );
  }
  const bad = wanted.find(([field]) => typeof body[field] !== 'boolean');
  if (bad) {
    return json({ error: `\`${bad[0]}\` must be a boolean` }, { status: 400 });
  }

  const applied: Record<string, boolean> = {};
  for (const [field, key] of wanted) {
    const value = body[field] as boolean;
    await setSetting(key, value);
    applied[field] = value;
    // Arming the unattended writer is the one state change worth finding in
    // journalctl the morning after a surprising config edit.
    if (field === 'autoApply') {
      console.warn(`[workflowdoctor] auto-apply switched ${value ? 'ON' : 'OFF'} by owner`);
    }
  }

  return json({ ok: true, ...applied });
};
