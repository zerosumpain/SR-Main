import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { loadLoopHealth, loopVerdict } from '$lib/daydream/loop-health';
import { MIN_PAIRS } from '$lib/daydream/stats/tests';
import { loadImprovementDashboard } from '$lib/dashboard/improvement.server';

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

export const load: PageServerLoad = async () => {
  const [loop, improvement] = await Promise.all([
    loadLoopHealth(MIN_PAIRS),
    loadImprovementDashboard().catch((err) => {
      console.error('[daydream] improvement load failed:', errMsg(err));
      return null;
    }),
  ]);
  const story = await loadLoopStory(loop);
  return { loop, loopVerdict: loopVerdict(loop), improvement, story };
};
