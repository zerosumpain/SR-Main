import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { loadLoopHealth, loopVerdict } from '$lib/daydream/loop-health';
import { MIN_PAIRS } from '$lib/daydream/stats/tests';
import { loadImprovementDashboard } from '$lib/dashboard/improvement.server';
import { EMPTY_APPETITE, toLead, type AppetiteView } from '$lib/daydream/appetite/view';
import { doctorRollup, EMPTY_DOCTOR_ROLLUP, type DoctorRollup } from '$lib/workflowdoctor/rollup';
import { doctorSchedule } from '$lib/heartbeat/activity-schedule';
import { loadOvernight } from '$lib/daydream/rooms/overnight.server';

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
  const [story, appetite, doctor, doctorWindow, night] = await Promise.all([
    loadLoopStory(loop),
    loadAppetite(),
    doctorRollup().catch((err): DoctorRollup => {
      console.error('[daydream] doctor rollup failed:', errMsg(err));
      return { ...EMPTY_DOCTOR_ROLLUP, error: errMsg(err) };
    }),
    doctorSchedule(),
    // What actually ran, from the pulse ledger. Its own catch, because a night
    // that cannot be read must not take the whole room down with it.
    loadOvernight(),
  ]);
  return { loop, loopVerdict: loopVerdict(loop), improvement, story, appetite, doctor, doctorWindow, night };
};
