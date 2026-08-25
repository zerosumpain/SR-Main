import type { Actions, PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { fail } from '@sveltejs/kit';
import os from 'node:os';
import { clampDays } from '$lib/server/hermes-sessions';
import { canManageHermes, IS_HOMESERV, rTelemetry, rStatus, rServiceAction } from '$lib/server/hermes-remote';
import { isServiceAction, type ServiceAction } from '$lib/server/hermes-control';
import { isHermesChatEnabled } from '$lib/server/models/settings';

export const load: PageServerLoad = async ({ url }) => {
  const days = clampDays(url.searchParams.get('days'));
  const manage = canManageHermes();
  // Both come from homeserv: direct on homeserv, proxied over Tailscale on the
  // VPS. Degrade to nulls (never 500) if homeserv is unreachable.
  const [status, telemetry] = await Promise.all([
    manage ? rStatus().catch(() => null) : Promise.resolve(null),
    manage ? rTelemetry(days).catch(() => null) : Promise.resolve(null),
  ]);

  return {
    health: status?.health ?? null,
    services: status?.services ?? { gateway: 'unknown' as const, dashboard: 'unknown' as const },
    version: status?.version ?? null,
    curator: status?.curator ?? null,
    // `version` and `curator` come from the `hermes` CLI reading a store that
    // stopped receiving anything when the engine did. Carried through so the
    // page can date them rather than render them as present tense.
    storeNewestAt: status?.storeNewestAt ?? null,
    telemetry,
    telemetryDays: days,
    // The live value, not the env var: the toggle below overrides it.
    flagEnabled: await isHermesChatEnabled(env.JKAI_HERMES_CANVAS_CHAT === '1').catch(
      () => env.JKAI_HERMES_CANVAS_CHAT === '1',
    ),
    flagEnvDefault: env.JKAI_HERMES_CANVAS_CHAT === '1',
    canManage: manage,
    direct: IS_HOMESERV,
    hostname: os.hostname(),
  };
};

function gateOrFail() {
  if (!canManageHermes()) {
    return fail(403, {
      action: 'gated',
      ok: false,
      stdout: '',
      stderr: `Hermes control unavailable from host "${os.hostname()}" — no homeserv route configured.`,
      durationMs: 0,
      exitCode: null,
    });
  }
  return null;
}

function actionFor(action: ServiceAction): Actions[string] {
  return async ({ request }) => {
    const blocked = gateOrFail();
    if (blocked) return blocked;
    // Defensive: the action name is the form key, but assert it's known.
    if (!isServiceAction(action)) return fail(400, { action, ok: false, stdout: '', stderr: 'unknown action', durationMs: 0, exitCode: null });
    void request;
    const r = await rServiceAction(action);
    return r.ok ? r : fail(500, r);
  };
}

export const actions: Actions = {
  restart_gateway: actionFor('restart_gateway'),
  restart_dashboard: actionFor('restart_dashboard'),
  restart_all: actionFor('restart_all'),
  update_check: actionFor('update_check'),
  update_hermes: actionFor('update_hermes'),
};
