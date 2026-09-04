import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { getSetting } from '$lib/server/models/settings';
import { ACTIVITY_SETTINGS_ENABLED_KEY } from '$lib/activity/config';
import { dueActivityJobCount, runNextActivityJob } from '$lib/activity/sync/runner.server';
import type { ActivityHandler } from '../types';

const WORKER_ID = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const MAX_JOBS_PER_TICK = 5;

export const activitySync: ActivityHandler = {
  name: 'activity-sync',
  description:
    'Drains the personal activity sync/import/erasure queue through provider adapters. Explicitly disabled until activity.enabled is true.',
  defaultCadenceSeconds: 60,
  defaultEnabled: true,
  async run() {
    if ((await getSetting<boolean>(ACTIVITY_SETTINGS_ENABLED_KEY)) !== true) {
      return { outcome: 'skipped', summary: 'activity fabric disabled' };
    }

    const outcomes: Record<string, number> = {};
    let processed = 0;
    for (; processed < MAX_JOBS_PER_TICK; processed++) {
      const result = await runNextActivityJob(WORKER_ID);
      outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
      if (result.outcome === 'empty') break;
    }
    const due = await dueActivityJobCount();
    return {
      outcome: outcomes.failed ? 'error' : 'ok',
      summary: `${processed} activity job${processed === 1 ? '' : 's'} handled; ${due} due`,
      details: { workerId: WORKER_ID, processed, due, outcomes },
    };
  },
};
