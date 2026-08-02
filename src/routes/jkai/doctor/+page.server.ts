import type { PageServerLoad } from './$types';
import { getCollectionBySlug, queryRecords } from '$lib/datastore';
import { getSetting } from '$lib/server/models/settings';
import { isAutoApplyEnabled, isBreakerEnabled } from '$lib/workflowdoctor/fix';
import {
  buildDoctorStories,
  summariseDoctorStories,
  type NarrativeFinding,
  type NarrativeRun,
} from '$lib/workflowdoctor/narrative';
import { getDoctorStatus } from '$lib/workflowdoctor/run';
import { triageNow, type TriageResult } from '$lib/workflowdoctor/triage';
import {
  COLLECTIONS,
  CRON_DISPLAY,
  CRON_EXPR,
  CRON_TZ,
  SETTINGS_ENABLED_KEY,
  WORK_CAPS,
  errMsg,
  type DoctorFindingData,
  type DoctorRunData,
  type FindingStatus,
} from '$lib/workflowdoctor/types';

// Owner-gated by hooks (the whole /jkai area is owner-only). Server load reads
// the doctor's audit trail via $lib/datastore as the `owner` actor, runs the
// read-only triage query live, and computes every plain-English sentence here
// rather than in the component. Every read tolerates a system collection not yet
// existing (they are seeded on engine boot / first run).

const OWNER = 'owner';

/** Enough nights for the sparkline and the runs browser, not the whole history. */
const RUN_LIMIT = 30;
const FINDING_LIMIT = 200;

async function loadRuns(): Promise<NarrativeRun[]> {
  if (!(await getCollectionBySlug(COLLECTIONS.doctorRuns))) return [];
  const { records } = await queryRecords(
    COLLECTIONS.doctorRuns,
    { sort: { field: 'createdAt', dir: 'desc' }, limit: RUN_LIMIT },
    OWNER,
  );
  return records.map((r) => ({
    runId: r.key ?? r.id,
    createdAt: r.createdAt.toISOString(),
    data: r.data as unknown as DoctorRunData,
  }));
}

async function loadFindings(): Promise<NarrativeFinding[]> {
  if (!(await getCollectionBySlug(COLLECTIONS.doctorFindings))) return [];
  const { records } = await queryRecords(
    COLLECTIONS.doctorFindings,
    { sort: { field: 'updatedAt', dir: 'desc' }, limit: FINDING_LIMIT },
    OWNER,
  );
  return records.map((r) => ({
    key: r.key ?? r.id,
    data: r.data as unknown as DoctorFindingData,
  }));
}

/**
 * The three switches, read through the doctor's own predicates.
 *
 * `isAutoApplyEnabled` / `isBreakerEnabled` are imported rather than
 * re-implemented here: they carry the inverted default-OFF semantics and the
 * fail-closed behaviour, and a second copy of that logic on the read side would
 * eventually disagree with the write side about what last night could do.
 */
async function loadSwitches(): Promise<{ enabled: boolean; autoApply: boolean; breaker: boolean }> {
  const [enabled, autoApply, breaker] = await Promise.all([
    getSetting<boolean>(SETTINGS_ENABLED_KEY),
    isAutoApplyEnabled(),
    isBreakerEnabled(),
  ]);
  // House semantics on the kill switch: unset/null is enabled.
  return { enabled: enabled !== false, autoApply, breaker };
}

/** Runs oldest-first, dropping nights that never reached a verdict. */
function sparkSeries(runs: NarrativeRun[]): Array<{ day: string; failing: number }> {
  return [...runs]
    .reverse()
    .filter((r) => r.data?.status === 'complete' || r.data?.status === 'partial')
    .map((r) => ({
      day: r.createdAt.slice(0, 10),
      failing: Number(r.data?.workflowsFailing ?? 0),
    }));
}

/**
 * Completed runs since the last night that found nothing failing.
 *
 * `null` means there has never been a clean night — not the same as zero, and
 * the tile says so rather than rendering a misleading 0.
 */
function nightsSinceClean(runs: NarrativeRun[]): number | null {
  let n = 0;
  for (const r of runs) {
    const finished = r.data?.status === 'complete' || r.data?.status === 'partial';
    if (!finished) continue;
    if (Number(r.data?.workflowsFailing ?? 0) === 0) return n;
    n++;
  }
  return null;
}

export const load: PageServerLoad = async () => {
  const [runs, findings, live, switches] = await Promise.all([
    loadRuns().catch((err) => {
      console.error('[workflowdoctor] page: runs read failed:', errMsg(err));
      return [] as NarrativeRun[];
    }),
    loadFindings().catch((err) => {
      console.error('[workflowdoctor] page: findings read failed:', errMsg(err));
      return [] as NarrativeFinding[];
    }),
    // The live gather query, so the page still answers "what is failing right
    // now" on a night the run was skipped, aborted, or never armed. Read-only.
    triageNow().catch((err) => {
      console.error('[workflowdoctor] page: live triage failed:', errMsg(err));
      return null as TriageResult | null;
    }),
    loadSwitches().catch((err) => {
      console.error('[workflowdoctor] page: settings read failed:', errMsg(err));
      // Fail closed, exactly as fix.ts does: an unreadable switch must not be
      // rendered as an armed one.
      return { enabled: true, autoApply: false, breaker: false };
    }),
  ]);

  const latest = runs[0] ?? null;

  // ── Findings roll-up ──────────────────────────────────────────────────────
  const byStatus = {} as Record<FindingStatus, number>;
  let stillFailingAfterFix = 0;
  for (const f of findings) {
    const s = f.data?.status ?? 'proposed';
    byStatus[s] = (byStatus[s] ?? 0) + 1;
    // The doctor changed this node and the failure is still on the books: either
    // the fix was rolled back in-run, or it was applied and then observed again
    // (which flips the record back to `proposed` but keeps the before-image).
    if (f.data?.beforeImage && (s === 'reverted' || s === 'proposed')) stillFailingAfterFix++;
  }
  const openFindings = findings.filter(
    (f) => f.data?.status !== 'resolved' && f.data?.status !== 'dismissed',
  ).length;

  // ── Run roll-up (over the loaded window) ──────────────────────────────────
  let llmCalls = 0;
  let costUsd = 0;
  let fixesApplied = 0;
  let fixesReverted = 0;
  let schedulesQuarantined = 0;
  for (const r of runs) {
    const d = r.data ?? ({} as DoctorRunData);
    llmCalls += Number(d.llmCalls ?? 0);
    costUsd += Number(d.costUsd ?? 0);
    fixesApplied += Number(d.fixesApplied ?? 0);
    fixesReverted += Number(d.fixesReverted ?? 0);
    schedulesQuarantined += Number(d.schedulesQuarantined ?? 0);
  }

  // The number the feature is graded on. Live where we have it — a stale count
  // from a run that never happened is the failure this page exists to prevent.
  const workflowsFailing = live?.workflowsFailing ?? Number(latest?.data?.workflowsFailing ?? 0);

  const stories = buildDoctorStories({ runs, findings });

  return {
    runs,
    stories,
    storySummary: summariseDoctorStories(stories),

    prime: {
      workflowsFailing,
      /** False when the triage query failed and the figure is last night's. */
      liveFigure: live !== null,
      fixedLastNight:
        Number(latest?.data?.fixesApplied ?? 0) + Number(latest?.data?.schedulesQuarantined ?? 0),
      quarantinedLastNight: Number(latest?.data?.schedulesQuarantined ?? 0),
      openProposals: byStatus.proposed ?? 0,
      refused: byStatus.refused_sensitive ?? 0,
      stillFailingAfterFix,
      nightsSinceClean: nightsSinceClean(runs),
      spark: sparkSeries(runs),
    },

    stats: {
      totalRuns: runs.length,
      lastRunAt: latest?.createdAt ?? null,
      openFindings,
      byStatus,
      fixesApplied,
      fixesReverted,
      schedulesQuarantined,
      llmCalls,
      costUsd: Number(costUsd.toFixed(4)),
    },

    /** The switch snapshot from the night itself, not today's setting. */
    lastRun: latest
      ? {
          runId: latest.runId,
          createdAt: latest.createdAt,
          status: latest.data?.status ?? 'failed',
          trigger: latest.data?.trigger ?? 'cron',
          // `executeTool` swallows send failures, which is why the other nightly
          // jobs are silent when the bridge is dead. This one records it.
          whatsappDelivered: latest.data?.whatsappDelivered === true,
          autoApplyEnabled: latest.data?.autoApplyEnabled === true,
          breakerEnabled: latest.data?.breakerEnabled === true,
        }
      : null,

    // Live triage — already redacted at source (`signatureOf` redacts before it
    // truncates), and capped by WORK_CAPS.
    signatures: live?.signatures ?? [],
    silent: live?.silentFailures ?? [],
    runaways: live?.runaways ?? [],
    deadNodeTypes: live?.deadNodeTypes ?? [],
    liveFailed: live === null,

    switches,
    lookbackDays: WORK_CAPS.lookbackDays,
    schedule: { expr: CRON_EXPR, tz: CRON_TZ, display: CRON_DISPLAY },
    running: getDoctorStatus().running,
  };
};
