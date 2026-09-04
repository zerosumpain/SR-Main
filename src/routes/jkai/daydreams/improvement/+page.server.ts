import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { loadLoopHealth, loopVerdict } from '$lib/daydream/loop-health';
import { MIN_PAIRS } from '$lib/daydream/stats/tests';
import { loadImprovementDashboard } from '$lib/dashboard/improvement.server';
import { describeCite, EMPTY_APPETITE, toLead, type AppetiteView } from '$lib/daydream/appetite/view';
import { EMPTY_BOARD, type BoardView } from '$lib/selfimprove/board';
import type { EpicData } from '$lib/selfimprove/types';
import { doctorRollup, EMPTY_DOCTOR_ROLLUP, type DoctorRollup } from '$lib/workflowdoctor/rollup';
import { doctorSchedule } from '$lib/heartbeat/activity-schedule';

/** The loop, end to end: faults raised → ideas → tools built → signals → findings → thoughts. */
export interface LoopStory {
  faults: { open: number; closed: number; total: number; byWants: Record<string, number> };
  backlog: { open: number; engine: number; shipped: number };
  toolsBuilt: number;
  toolSignals: number;
  findings7d: number;
  thoughts7d: number;
  error: string | null;
}

async function loadLoopStory(loop: Awaited<ReturnType<typeof loadLoopHealth>>): Promise<LoopStory> {
  const empty: LoopStory = {
    faults: { open: 0, closed: 0, total: 0, byWants: {} },
    backlog: { open: 0, engine: 0, shipped: 0 },
    toolsBuilt: loop.tools.shippedRecently,
    toolSignals: loop.toolSignals?.sweepable ?? 0,
    findings7d: 0,
    thoughts7d: 0,
    error: null,
  };
  try {
    const [{ faultCounts }, { listBacklog }, { recentFindings }, { loadCounts }] = await Promise.all([
      import('$lib/daydream/faults'),
      import('$lib/selfimprove/backlog'),
      import('$lib/daydream/stats/findings'),
      import('$lib/daydream/ledger'),
    ]);
    const [faults, backlog, findings, counts] = await Promise.all([faultCounts(), listBacklog(), recentFindings({ days: 7, limit: 200 }), loadCounts()]);
    return {
      ...empty,
      faults,
      backlog: {
        open: backlog.filter((b) => b.status === 'open').length,
        engine: backlog.filter((b) => b.status === 'open' && b.kind === 'engine').length,
        shipped: backlog.filter((b) => b.status === 'shipped').length,
      },
      findings7d: findings.length,
      thoughts7d: counts.thoughts7d,
    };
  } catch (err) {
    console.error('[daydream] loop story failed:', errMsg(err));
    return { ...empty, error: errMsg(err) };
  }
}

/**
 * The appetite ledger, for the room.
 *
 * Loaded here rather than in a `$lib` view module because the row shape comes
 * from the database and the card shape may not: a `.svelte` file importing
 * anything that reaches `$lib/db` fails the build. `toLead` is the pure half
 * and lives next to the vocabulary it uses.
 */
async function loadAppetite(): Promise<AppetiteView> {
  try {
    const [{ listCapabilities, capabilityCounts }] = await Promise.all([import('$lib/daydream/appetite/store')]);
    const [rows, counts] = await Promise.all([listCapabilities({ limit: 40 }), capabilityCounts()]);
    return {
      leads: rows.map(toLead),
      counts: { total: counts.total, byStatus: counts.byStatus, byKind: counts.byKind },
      newDataOpen: rows.filter(
        (r) => (r.status === 'proposed' || r.status === 'queued') && (r.kind === 'data_source' || r.kind === 'news_source' || r.kind === 'watch'),
      ).length,
      error: null,
    };
  } catch (err) {
    console.error('[daydream] appetite load failed:', errMsg(err));
    return { ...EMPTY_APPETITE, error: errMsg(err) };
  }
}

/**
 * The queue, as a board.
 *
 * Joined HERE rather than in a `$lib` module for the same reason the doctor
 * rollup is: a route load may import both engines, and neither library may
 * import the other. `buildBoard` itself is pure and lives in
 * `$lib/selfimprove/board.ts`, so the derivation is unit-tested without a
 * database and the component imports it for its labels and its filter.
 *
 * `MAX_ATTEMPTS` is passed IN rather than read inside the pure module — one
 * definition of the attempt ceiling, in `backlog.ts`, where the engine reads
 * it too.
 */
async function loadQueueBoard(): Promise<BoardView> {
  try {
    const [{ buildBoard }, { listBacklog, MAX_ATTEMPTS }, { loadCustomToolHealth }, { listCapabilities }, { listEpics }] =
      await Promise.all([
        import('$lib/selfimprove/board'),
        import('$lib/selfimprove/backlog'),
        import('$lib/selfimprove/context'),
        import('$lib/daydream/appetite/store'),
        import('$lib/selfimprove/epics'),
      ]);
    const [backlog, tools, caps, epics] = await Promise.all([
      listBacklog(),
      loadCustomToolHealth(),
      listCapabilities({ limit: 60 }),
      listEpics(),
    ]);
    return buildBoard({
      backlog,
      tools,
      capabilities: caps.map((c) => ({
        slug: c.slug,
        kind: c.kind,
        title: c.title,
        need: c.need,
        status: c.status,
        score: c.score,
        lane: c.lane,
        outcome: c.outcome,
        outcomeRef: c.outcomeRef,
        backlogSlug: c.backlogSlug,
        evidence: [...new Set(c.cites.map(describeCite))].slice(0, 4),
        lastSeenAt: c.lastSeenAt,
      })),
      attemptCeiling: MAX_ATTEMPTS,
      // So a swimlane reads the theme's own label rather than its slug digest.
      epicLabels: Object.fromEntries(epics.map((e) => [e.slug, e.label])),
      // The open pile is the point of the board; everything ever shipped is
      // history and belongs in the ledger below it. 120 keeps a few months of
      // settled work reachable without sending 455 rows to the browser.
      settledLimit: 120,
    });
  } catch (err) {
    console.error('[daydream] queue board failed:', errMsg(err));
    return { ...EMPTY_BOARD, error: errMsg(err) };
  }
}

/**
 * The themes found in the queue, and what has been decided about them.
 *
 * Read only — finding them is an action, not a page load. `clusterBacklog` is
 * 66ms over 455 rows, but it also WRITES proposals, and a page render must
 * never be a write.
 */
async function loadEpics(): Promise<{ epics: EpicData[]; error: string | null }> {
  try {
    const { listEpics } = await import('$lib/selfimprove/epics');
    return { epics: await listEpics(), error: null };
  } catch (err) {
    console.error('[daydream] epics load failed:', errMsg(err));
    return { epics: [], error: errMsg(err) };
  }
}

export const load: PageServerLoad = async () => {
  const [loop, improvement] = await Promise.all([
    loadLoopHealth(MIN_PAIRS),
    loadImprovementDashboard().catch((err) => {
      console.error('[daydream] improvement load failed:', errMsg(err));
      return null;
    }),
  ]);
  // The doctor, folded in. A route-level load may import both engines, which
  // is what makes this the honest place to join them — `$lib/workflowdoctor`
  // already imports `$lib/selfimprove`, so neither library could do it.
  const [story, appetite, board, epics, doctor, doctorWindow] = await Promise.all([
    loadLoopStory(loop),
    loadAppetite(),
    loadQueueBoard(),
    loadEpics(),
    doctorRollup().catch((err): DoctorRollup => {
      console.error('[daydream] doctor rollup failed:', errMsg(err));
      return { ...EMPTY_DOCTOR_ROLLUP, error: errMsg(err) };
    }),
    doctorSchedule(),
  ]);
  return { loop, loopVerdict: loopVerdict(loop), improvement, story, appetite, board, epics, doctor, doctorWindow };
};
