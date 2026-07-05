import type { Actions, PageServerLoad } from './$types';
import os from 'node:os';
import { fail } from '@sveltejs/kit';
import { canManageHermes, IS_HOMESERV, rCron, rCronOp } from '$lib/server/hermes-remote';
import { CRON_DELIVERIES, type CronDelivery, type CronOp } from '$lib/server/hermes-cron';

export const load: PageServerLoad = async () => {
  const manage = canManageHermes();
  const base = { hostname: os.hostname(), canManage: manage, direct: IS_HOMESERV, deliveries: CRON_DELIVERIES };
  if (!manage) return { ...base, available: false, jobs: [], error: null };
  try {
    return { ...base, available: true, jobs: await rCron(), error: null };
  } catch (e) {
    return { ...base, available: true, jobs: [], error: (e as Error).message };
  }
};

function gate() {
  if (!canManageHermes()) {
    return fail(403, { ok: false, error: `Hermes cron unavailable from host "${os.hostname()}" — no homeserv route configured.` });
  }
  return null;
}

function idAction(op: 'pause' | 'resume' | 'run' | 'remove'): Actions[string] {
  return async ({ request }) => {
    const blocked = gate();
    if (blocked) return blocked;
    const id = String((await request.formData()).get('id') ?? '');
    const r = await rCronOp({ op, id });
    return r.ok ? { ok: true, op } : fail(400, { ok: false, error: r.error || r.stderr || `cron ${op} failed` });
  };
}

export const actions: Actions = {
  create: async ({ request }) => {
    const blocked = gate();
    if (blocked) return blocked;
    const f = await request.formData();
    const deliver = String(f.get('deliver') ?? 'whatsapp');
    if (!(CRON_DELIVERIES as readonly string[]).includes(deliver)) {
      return fail(400, { ok: false, error: 'deliver must be whatsapp or local' });
    }
    const repeatRaw = String(f.get('repeat') ?? '').trim();
    const op: CronOp = {
      op: 'create',
      schedule: String(f.get('schedule') ?? '').trim(),
      prompt: String(f.get('prompt') ?? '').trim() || undefined,
      name: String(f.get('name') ?? '').trim() || undefined,
      deliver: deliver as CronDelivery,
      repeat: repeatRaw ? Number(repeatRaw) : undefined,
    };
    const r = await rCronOp(op);
    return r.ok
      ? { ok: true, op: 'create', jobId: r.jobId }
      : fail(400, { ok: false, error: r.error || r.stderr || 'cron create failed' });
  },
  pause: idAction('pause'),
  resume: idAction('resume'),
  run: idAction('run'),
  remove: idAction('remove'),
};
