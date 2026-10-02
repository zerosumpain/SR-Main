import type { PageServerLoad } from './$types';
import { isOwnerRequest } from '$lib/server/owner';
import { memberDoctorRun } from '$lib/member-view';
import { doctorOverview, type DoctorOverview } from '$lib/workflows/doctor-client';

// Owner-gated by hooks (the whole /jkai area is owner-only, a member reads it
// through the access catalogue). The workflow doctor lives in SR-Workflows
// since 2026-10-02: this load asks it for the owner's page (`doctor_overview`
// over the runtime contract) and only decides how much of it a member sees.
// Every plain-English sentence is still composed server-side, there, never in
// the component.

/** What the page renders when SR-Workflows cannot be reached. */
function unavailable(): DoctorOverview {
  return {
    runs: [],
    stories: [],
    storySummary: '',
    prime: {
      workflowsFailing: 0,
      liveFigure: false,
      fixedLastNight: 0,
      quarantinedLastNight: 0,
      openProposals: 0,
      refused: 0,
      stillFailingAfterFix: 0,
      nightsSinceClean: null,
      spark: [],
    },
    stats: { totalRuns: 0, lastRunAt: null, openFindings: 0, byStatus: {}, fixesApplied: 0, fixesReverted: 0, schedulesQuarantined: 0, llmCalls: 0, costUsd: 0 },
    lastRun: null,
    signatures: [],
    silent: [],
    runaways: [],
    deadNodeTypes: [],
    liveFailed: true,
    // Fail closed, as the doctor does: an unreadable switch is never shown armed.
    switches: { enabled: true, autoApply: false, breaker: false },
    lookbackDays: 7,
    schedule: { expr: '05:00–05:55 Europe/London', tz: 'Europe/London', display: '05:00 Europe/London', armed: false },
    running: false,
    queuedRunId: null,
    controls: { caps: { breakerFailures: 0, workflows: 0, fixes: 0, quietHours: 0 }, findings: [] },
  };
}

export const load: PageServerLoad = async (event) => {
  const remote = await doctorOverview().catch((err) => {
    console.error('[workflowdoctor] page: overview unavailable:', err instanceof Error ? err.message : err);
    return null;
  });
  const { controls, ...page } = remote ?? unavailable();
  const member = !(await isOwnerRequest(event));

  if (!member) {
    // The switches, Run now and undo list. Owner only; a before-image's values
    // never leave SR-Workflows — the findings carry field names.
    return { ...page, unavailable: remote === null, member, controls: remote ? controls : null };
  }
  // jkai · develop, read-only for a member: the numbers of each night, never
  // WHICH workflows failed or why. Stories, signatures, silent failures and
  // runaways name the owner's canvases and quote their errors, which touch his
  // mail, health and money; the summary line is counts only, so it stays.
  return {
    ...page,
    unavailable: remote === null,
    member,
    controls: null,
    runs: page.runs.map(memberDoctorRun),
    stories: [],
    stats: { ...page.stats, costUsd: 0 },
    signatures: [],
    silent: [],
    runaways: [],
    deadNodeTypes: [],
    queuedRunId: null,
  };
};
