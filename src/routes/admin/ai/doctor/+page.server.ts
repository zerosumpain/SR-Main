import type { PageServerLoad } from './$types';
import { getCollectionBySlug, queryRecords } from '$lib/datastore';
import { getSetting } from '$lib/server/models/settings';
import { listFindings } from '$lib/workflowdoctor/findings';
import { getDoctorStatus } from '$lib/workflowdoctor/run';
import {
  COLLECTIONS,
  CRON_DISPLAY,
  CRON_EXPR,
  CRON_TZ,
  FIX_KIND_LABELS,
  SETTINGS_AUTOAPPLY_KEY,
  SETTINGS_BREAKER_KEY,
  SETTINGS_ENABLED_KEY,
  WORK_CAPS,
  errMsg,
  type DoctorFindingData,
} from '$lib/workflowdoctor/types';

// The doctor's CONTROL surface — switches, "Run now", and the undo list. The
// narrative report lives at /jkai/doctor; this page is deliberately the boring
// one. Owner-gated in hooks.server.ts (page + /api/admin/*), so there is no auth
// code here. Reads go through $lib/datastore as the `owner` actor; every
// mutation goes out through /api/admin/doctor/*, matching the improvement admin
// page.
//
// Each read tolerates the system collections not existing yet — the engine
// seeds them on boot, and this is the page you open when the engine is the
// thing that is broken.

const OWNER = 'owner';

/** What the browser is allowed to know about a finding. */
export interface FindingView {
  key: string;
  workflowId: string;
  workflowName: string;
  canvasSlug: string | null;
  nodeId: string | null;
  nodeType: string | null;
  nodeLabel: string | null;
  fixKind: DoctorFindingData['fixKind'];
  /** Resolved here so the page never has to import the engine's constants. */
  fixKindLabel: string;
  status: DoctorFindingData['status'];
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  updatedAt: string;
  symptom: string;
  cause: string;
  causeSource: DoctorFindingData['causeSource'];
  fix: string;
  sensitiveFields?: string[];
  /** null = nothing to undo. Drives which revert path the API will take. */
  revertKind: 'node' | 'schedule' | null;
  /** Field NAMES from the before-image. The values never leave the server. */
  changedFields: string[];
  verifyBefore?: number;
  verifyAfter?: number;
}

async function loadRuns() {
  try {
    if (!(await getCollectionBySlug(COLLECTIONS.doctorRuns))) return [];
    const { records } = await queryRecords(
      COLLECTIONS.doctorRuns,
      { sort: { field: 'createdAt', dir: 'desc' }, limit: 30 },
      OWNER,
    );
    return records.map((r) => ({ runId: r.key, createdAt: r.createdAt, data: r.data }));
  } catch (err) {
    console.error('[workflowdoctor] admin loadRuns failed:', errMsg(err));
    return [];
  }
}

/**
 * A before-image holds the OLD VALUES of the config keys the doctor changed —
 * i.e. exactly the payload the whole feature refuses to republish. The page
 * needs to say *which fields* moved so a human can judge the undo; it never
 * needs the values, so they are dropped here rather than in the template.
 */
function toView(row: { key: string; data: DoctorFindingData }): FindingView {
  const before = row.data.beforeImage;
  return {
    key: row.key,
    workflowId: row.data.workflowId,
    workflowName: row.data.workflowName,
    canvasSlug: row.data.canvasSlug,
    nodeId: row.data.nodeId,
    nodeType: row.data.nodeType,
    nodeLabel: row.data.nodeLabel,
    fixKind: row.data.fixKind,
    fixKindLabel: FIX_KIND_LABELS[row.data.fixKind] ?? row.data.fixKind,
    status: row.data.status,
    occurrences: row.data.occurrences ?? 0,
    firstSeen: row.data.firstSeen,
    lastSeen: row.data.lastSeen,
    updatedAt: row.data.updatedAt,
    symptom: row.data.symptom,
    cause: row.data.cause,
    causeSource: row.data.causeSource,
    fix: row.data.fix,
    sensitiveFields: row.data.sensitiveFields,
    revertKind: before ? (before.scheduleId ? 'schedule' : 'node') : null,
    changedFields: Object.keys(before?.changedFields ?? {}),
    verifyBefore: row.data.verifyBefore,
    verifyAfter: row.data.verifyAfter,
  };
}

export const load: PageServerLoad = async () => {
  const [runs, findingRows, enabledSetting, autoApplySetting, breakerSetting] = await Promise.all([
    loadRuns(),
    listFindings({ limit: 200 }),
    getSetting(SETTINGS_ENABLED_KEY),
    getSetting(SETTINGS_AUTOAPPLY_KEY),
    getSetting(SETTINGS_BREAKER_KEY),
  ]);

  const status = getDoctorStatus();

  return {
    // Three switches, two semantics. Nightly runs and the breaker are on unless
    // explicitly false (the house idiom); auto-apply is off unless explicitly
    // true, because an unattended writer must not enable itself.
    enabled: enabledSetting !== false,
    breaker: breakerSetting !== false,
    autoApply: autoApplySetting === true,
    schedule: { expr: CRON_EXPR, tz: CRON_TZ, display: CRON_DISPLAY },
    // The switch copy quotes these numbers. Passed rather than typed into the
    // page so a cap change cannot leave the warning describing the old engine.
    caps: {
      breakerFailures: WORK_CAPS.breakerConsecutiveFailures,
      workflows: WORK_CAPS.maxWorkflowsMutated,
      fixes: WORK_CAPS.maxAutoFixesTotal,
      quietHours: WORK_CAPS.humanEditQuietHours,
    },
    running: status.running,
    lastRunId: status.lastRunId ?? null,
    runs,
    findings: findingRows.map(toView),
  };
};
