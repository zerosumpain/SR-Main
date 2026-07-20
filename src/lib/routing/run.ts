// Selection pipeline: refresh catalogue → select per profile → persist
// assignments + run → WhatsApp confirm. Mirrors briefing/run.ts (single-flight
// guard, best-effort notify, never throws into the caller). Kill switch honoured.
import { randomUUID } from 'crypto';
import { refreshOpenRouterCatalogue } from '$lib/server/models/openrouter-catalogue';
import { selectModels } from './select';
import {
  ensureRoutingCollections,
  isRoutingEnabled,
  getRoutingConfig,
  loadAssignments,
  saveAssignments,
  persistRun,
} from './events';
import {
  OWNER_PHONE,
  PROFILES,
  PROFILE_LABEL,
  errMsg,
  type RoutingRun,
  type RoutingAssignments,
} from './types';

const ADMIN_LINK = 'https://strangeramblings.com/admin/ai/model-routing';

let running = false;
export function isSelectionRunning(): boolean {
  return running;
}

function buildWhatsapp(a: RoutingAssignments): string {
  const lines = PROFILES.map((p) => {
    const m = a[p];
    return `${PROFILE_LABEL[p]}: ${m ? m.modelName : '(no eligible model)'}`;
  });
  return ['🧠 Model routing updated', ...lines, ADMIN_LINK].join('\n').slice(0, 600);
}

async function notify(a: RoutingAssignments): Promise<boolean> {
  try {
    const { executeTool } = await import('$lib/workflows/site-tools/registry');
    await executeTool('whatsapp_send', { to: OWNER_PHONE, message: buildWhatsapp(a) });
    return true;
  } catch (err) {
    console.error('[routing] whatsapp notify failed:', errMsg(err));
    return false;
  }
}

export async function runSelectionNow(opts?: {
  trigger?: 'cron' | 'manual';
  skipRefresh?: boolean;
  skipNotify?: boolean;
}): Promise<{ id: string; run: RoutingRun }> {
  if (running) throw new Error('a selection is already running');
  running = true;
  const id = randomUUID();
  const run: RoutingRun = {
    id,
    trigger: opts?.trigger ?? 'manual',
    status: 'running',
    startedAt: new Date().toISOString(),
    assignments: {},
    candidateCounts: {},
    catalogueSize: 0,
    whatsappSent: false,
  };

  try {
    await ensureRoutingCollections();

    if (!(await isRoutingEnabled())) {
      // Kill switch off — leave existing assignments in place, record a skip.
      run.status = 'complete';
      run.assignments = await loadAssignments();
      run.finishedAt = new Date().toISOString();
      await persistRun(run);
      return { id, run };
    }

    // Fresh prices/quality/throughput. Best-effort — carry on with stored
    // catalogue if OpenRouter is unreachable.
    if (!opts?.skipRefresh) {
      try {
        await refreshOpenRouterCatalogue();
      } catch (err) {
        console.warn('[routing] catalogue refresh failed, using stored rows:', errMsg(err));
      }
    }

    const config = await getRoutingConfig();
    const { assignments, candidateCounts, catalogueSize } = await selectModels(config);
    run.assignments = assignments;
    run.candidateCounts = candidateCounts;
    run.catalogueSize = catalogueSize;

    await saveAssignments(assignments);

    if (!opts?.skipNotify) {
      run.whatsappSent = await notify(assignments);
    }
    run.status = 'complete';
    run.finishedAt = new Date().toISOString();
    await persistRun(run);
  } catch (err) {
    run.status = 'failed';
    run.error = errMsg(err);
    run.finishedAt = new Date().toISOString();
    try {
      await persistRun(run);
    } catch {
      /* best-effort */
    }
  } finally {
    running = false;
  }
  return { id, run };
}
