// Monitor-hit web push — when a MONITOR workflow's run completes cleanly and
// its dedupe step surfaced new items, push a notification with a preview and a
// deep link into the PWA. Complements the WhatsApp send the generated workflow
// does itself: push is the tap-to-open-the-app channel (see /jkai/daydreams?tab=watches).
//
// Contract mirrors run-notifications: NEVER throws, and stays silent unless the
// workflow is actually a registered monitor (marker in the `monitors` datastore
// collection). The dedupe check runs first so non-monitor runs (the vast
// majority) pay zero datastore queries.
import { MONITORS_COLLECTION, type MonitorMarker } from './monitors.server';

const MAX_PREVIEW = 140;

export interface MonitorHitArgs {
  workflowId: string;
  runId: string;
  /** Outputs of the run's dedupe nodes (the engine already collects these
   *  for the deferred-record commit on clean completion). */
  dedupeOutputs: Array<Record<string, unknown> | undefined>;
}

function extractHit(outputs: MonitorHitArgs['dedupeOutputs']): { newCount: number; preview: string } | null {
  let newCount = 0;
  const previews: string[] = [];
  for (const out of outputs) {
    if (!out || typeof out.newCount !== 'number' || out.newCount <= 0) continue;
    newCount += out.newCount;
    const items = Array.isArray(out.newItems) ? out.newItems : Array.isArray(out.items) ? out.items : [];
    for (const i of items.slice(0, 2)) {
      previews.push(typeof i === 'string' ? i : JSON.stringify(i));
    }
  }
  if (newCount <= 0) return null;
  return { newCount, preview: previews.join(' · ').slice(0, MAX_PREVIEW) };
}

/**
 * Push "your monitor found N new things" to the owner's devices. Call on clean
 * run completion only — that matches when dedupe records commit, so a failed
 * send that retries the same items next run cannot double-push.
 */
export async function notifyMonitorHit(args: MonitorHitArgs): Promise<void> {
  try {
    // Child (sub-workflow) runs surface through their parent.
    if (args.runId.startsWith('sub-')) return;
    const hit = extractHit(args.dedupeOutputs);
    if (!hit) return;

    // Only registered monitors push — lazy imports keep this off the engine's
    // module-init path (datastore + web-push pull server-only deps).
    const { getCollectionBySlug } = await import('$lib/datastore/collections');
    if (!(await getCollectionBySlug(MONITORS_COLLECTION))) return;
    const { getRecordByKey } = await import('$lib/datastore/records');
    let marker: MonitorMarker | null = null;
    try {
      const record = await getRecordByKey(MONITORS_COLLECTION, args.workflowId, 'jkai');
      marker = record.data as unknown as MonitorMarker;
    } catch {
      return; // not a monitor — silent
    }
    if (!marker) return;

    const { notifyAllSubscribers } = await import('$lib/server/push');
    const what = marker.description.length > 60 ? `${marker.description.slice(0, 57)}…` : marker.description;
    await notifyAllSubscribers({
      title: `Monitor: ${hit.newCount} new`,
      body: hit.preview ? `${what} — ${hit.preview}` : what,
      url: '/jkai/daydreams?tab=watches',
    });
  } catch (err) {
    // Belt-and-braces: a push hiccup must never affect the run.
    console.error('[monitors] push notify failed:', err instanceof Error ? err.message : err);
  }
}
