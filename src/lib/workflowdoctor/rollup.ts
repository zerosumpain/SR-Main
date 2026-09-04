// src/lib/workflowdoctor/rollup.ts
//
// The doctor, in six numbers, for the Improvement room.
//
// The full report stays at `/jkai/daydreams/doctor` — 800 lines of symptom,
// cause and fix that would make a four-thousand-line component if they were
// moved here, which is the lesson M5 recorded when `/jkai/improvement` was
// nearly folded into the hub the same way. What belongs in the unified room is
// the ANSWER: is anything broken, did the doctor fix it, and did what it
// could not fix reach the queue that can.

import { listFindings } from './findings';
import { errMsg, type DoctorRunData, type FindingStatus } from './types';
import { COLLECTIONS, SYSTEM_ACTOR } from './types';
import { getCollectionBySlug, queryRecords } from '$lib/datastore';

export interface DoctorRollup {
  /** Findings the doctor has not settled, by state. */
  byStatus: Partial<Record<FindingStatus, number>>;
  openFindings: number;
  /** Fixes it applied itself, last night. */
  fixedLastNight: number;
  /** Schedules the breaker stopped, last night. */
  quarantinedLastNight: number;
  /** Findings handed to the fault ledger for a code change, last night. */
  escalatedLastNight: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  error: string | null;
}

export const EMPTY_DOCTOR_ROLLUP: DoctorRollup = {
  byStatus: {},
  openFindings: 0,
  fixedLastNight: 0,
  quarantinedLastNight: 0,
  escalatedLastNight: 0,
  lastRunAt: null,
  lastRunStatus: null,
  error: null,
};

/** Statuses that mean nobody has dealt with it. `accepted` and `dismissed` are
 *  verdicts a human reached, so they are not open however long they sit. */
const OPEN: ReadonlyArray<FindingStatus> = ['proposed', 'refused_sensitive'];

export async function doctorRollup(): Promise<DoctorRollup> {
  try {
    const findings = await listFindings({ limit: 200 });
    const byStatus: Partial<Record<FindingStatus, number>> = {};
    for (const f of findings) {
      const s = (f.data?.status ?? 'proposed') as FindingStatus;
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    }

    let last: { createdAt: string; data: DoctorRunData } | null = null;
    if (await getCollectionBySlug(COLLECTIONS.doctorRuns)) {
      const { records } = await queryRecords(
        COLLECTIONS.doctorRuns,
        // `createdAt`, not the record's own `startedAt`: the datastore sorts on
        // its columns, not on jsonb fields, and the two agree for a run record.
        { sort: { field: 'createdAt', dir: 'desc' }, limit: 1 },
        SYSTEM_ACTOR,
      );
      const r = records[0];
      if (r) last = { createdAt: String(r.createdAt ?? ''), data: r.data as unknown as DoctorRunData };
    }

    const actions = last?.data?.actions ?? [];
    const count = (kind: string) => actions.filter((a) => a.kind === kind).length;

    return {
      byStatus,
      openFindings: OPEN.reduce((n, s) => n + (byStatus[s] ?? 0), 0),
      fixedLastNight: count('fix_applied'),
      quarantinedLastNight: count('schedule_quarantined'),
      escalatedLastNight: count('escalated'),
      lastRunAt: last?.createdAt ?? null,
      lastRunStatus: last?.data?.status ?? null,
      error: null,
    };
  } catch (err) {
    // A rollup that cannot be read says so. An empty grid and a broken query
    // must not look the same — "no findings" is the good news here, and it is
    // the one thing a silent failure would counterfeit.
    return { ...EMPTY_DOCTOR_ROLLUP, error: errMsg(err) };
  }
}
