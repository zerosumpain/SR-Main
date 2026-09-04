import type { PageServerLoad } from './$types';
import { describeCite } from '$lib/daydream/appetite/view';
import { errMsg } from '$lib/daydream/types';
import { improvementSchedule } from '$lib/heartbeat/activity-schedule';
import { EMPTY_BOARD, type BoardView } from '$lib/selfimprove/board';
import { BUDGET_CAPS, WORK_CAPS, type EpicData } from '$lib/selfimprove/types';

/**
 * Join the self-improvement ledger to live tool health for the queue room.
 *
 * `buildBoard` is deliberately pure; this route is the server boundary where
 * datastore rows, capability leads and tool telemetry can safely meet.
 */
async function loadQueueBoard(epics: EpicData[]): Promise<BoardView> {
  try {
    const [{ buildBoard }, { listBacklog, MAX_ATTEMPTS }, { loadCustomToolHealth }, { listCapabilities }] =
      await Promise.all([
        import('$lib/selfimprove/board'),
        import('$lib/selfimprove/backlog'),
        import('$lib/selfimprove/context'),
        import('$lib/daydream/appetite/store'),
      ]);
    const [backlog, tools, capabilities] = await Promise.all([
      listBacklog(),
      loadCustomToolHealth(),
      listCapabilities({ limit: 60 }),
    ]);
    return buildBoard({
      backlog,
      tools,
      capabilities: capabilities.map((capability) => ({
        slug: capability.slug,
        kind: capability.kind,
        title: capability.title,
        need: capability.need,
        status: capability.status,
        score: capability.score,
        lane: capability.lane,
        outcome: capability.outcome,
        outcomeRef: capability.outcomeRef,
        backlogSlug: capability.backlogSlug,
        evidence: [...new Set(capability.cites.map(describeCite))].slice(0, 4),
        lastSeenAt: capability.lastSeenAt,
      })),
      attemptCeiling: MAX_ATTEMPTS,
      epicLabels: Object.fromEntries(epics.map((epic) => [epic.slug, epic.label])),
      // Open work is never trimmed. Settled history is bounded so the modal
      // stays useful without sending the entire lifetime ledger to a browser.
      settledLimit: 120,
    });
  } catch (err) {
    console.error('[daydream] backlog board failed:', errMsg(err));
    return { ...EMPTY_BOARD, error: errMsg(err) };
  }
}

/** Read-only on arrival: finding new themes is an explicit button action. */
async function loadEpics(): Promise<{ epics: EpicData[]; error: string | null }> {
  try {
    const { listEpics } = await import('$lib/selfimprove/epics');
    return { epics: await listEpics(), error: null };
  } catch (err) {
    console.error('[daydream] backlog themes failed:', errMsg(err));
    return { epics: [], error: errMsg(err) };
  }
}

export const load: PageServerLoad = async () => {
  // The board needs accepted theme labels before it can name its swimlanes.
  // The schedule is independent and can load alongside the board.
  const epics = await loadEpics();
  const [board, schedule] = await Promise.all([loadQueueBoard(epics.epics), improvementSchedule()]);
  const caps = {
    tools: WORK_CAPS.maxToolCandidates,
    builds: WORK_CAPS.maxChangeRequests,
    watches: WORK_CAPS.maxWatches,
    repairs: WORK_CAPS.maxToolsRepaired,
    calls: BUDGET_CAPS.maxLlmCalls,
    minutes: Math.round(BUDGET_CAPS.maxWallMs / 60_000),
    window: schedule.window,
  };
  return { board, epics, caps };
};
