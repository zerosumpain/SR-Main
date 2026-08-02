// src/lib/workflowdoctor/findings.ts
//
// The doctor's memory between nights.
//
// A finding is keyed by (workflowId, nodeId, signature), so the same failure
// arriving on ten consecutive nights updates ONE record with a rising
// occurrence count instead of writing ten. The accumulation IS the signal:
// `icloud-cal` failed 5,053 times before a human noticed, and a store that
// duplicated per night would have buried the number it exists to raise.
//
// This is also the last gate before machine-written text reaches a surface the
// owner reads, so signature/symptom/cause/fix are scrubbed on the way IN, not
// on the way out — the release-log leak is the precedent: text written about a
// bug quotes the data that caused it.

import {
  DatastoreError,
  ensureCollection,
  getCollectionBySlug,
  getRecordByKey,
  queryRecords,
  upsertRecord,
} from '$lib/datastore';
import { redactSensitive } from '$lib/security/sensitive';
import {
  COLLECTIONS,
  SYSTEM_ACTOR,
  SYSTEM_PERMISSIONS,
  asData,
  errMsg,
  findingKey,
  type DoctorFindingData,
  type FindingStatus,
  type FixKind,
} from './types';

/** A finding as observed by a phase, before it becomes a record. */
export interface FindingInput {
  workflowId: string;
  workflowName: string;
  canvasSlug?: string | null;
  nodeId?: string | null;
  nodeType?: string | null;
  nodeLabel?: string | null;
  /** Raw extractSignature() output — redacted here, never by the caller. */
  signature: string;
  fixKind: FixKind;
  status: FindingStatus;
  /** Failures observed in THIS run. Added to the running total, not assigned. */
  occurrences?: number;
  symptom: string;
  cause: string;
  causeSource: DoctorFindingData['causeSource'];
  fix: string;
  lintIssues?: DoctorFindingData['lintIssues'];
  /** Field NAMES only; values are stripped defensively on the way in. */
  sensitiveFields?: string[];
  beforeImage?: DoctorFindingData['beforeImage'];
  verifyBefore?: number;
  verifyAfter?: number;
  runId?: string | null;
}

/** A stored finding plus its datastore key — the handle the UI acts on. */
export interface DoctorFindingRow {
  key: string;
  data: DoctorFindingData;
}

export interface ListFindingsOptions {
  limit?: number;
  status?: FindingStatus | FindingStatus[];
}

/**
 * A human verdict outranks anything the doctor merely OBSERVED: re-proposing
 * something the owner dismissed is exactly the nightly noise this store exists
 * to stop. A status recording an actual mutation still wins, because the record
 * would otherwise lie about what happened to the node.
 */
const HUMAN_VERDICTS: readonly FindingStatus[] = ['accepted', 'dismissed'];
const OBSERVED_ONLY: readonly FindingStatus[] = ['proposed', 'resolved'];

/** Statuses a run may close out. A verdict, a revert and a refusal are left alone. */
const OPEN_STATUSES: readonly FindingStatus[] = ['proposed', 'auto_fixed'];

/** Read cap for the sweep — MAX_LIMIT in the datastore query compiler. */
const SWEEP_LIMIT = 500;

/**
 * Create the two system collections if absent. Idempotent — `ensureCollection`
 * returns an existing collection untouched — and host-agnostic, so it is safe on
 * every boot (homeserv included, where the cron never arms) and again at run
 * start. Mirrors `ensureSystemCollections()` in $lib/selfimprove/seed-apis.
 */
export async function ensureDoctorCollections(): Promise<void> {
  await ensureCollection(
    COLLECTIONS.doctorRuns,
    {
      name: 'Doctor Runs',
      description:
        'One record per nightly workflow-doctor run (status, phases, budget, actions, report).',
      isSystem: true,
      defaultPermissions: SYSTEM_PERMISSIONS.doctor_runs,
    },
    SYSTEM_ACTOR,
  );
  await ensureCollection(
    COLLECTIONS.doctorFindings,
    {
      name: 'Doctor Findings',
      description:
        'One record per workflow + node + error signature — the accumulating triage of what is broken and what was done about it.',
      isSystem: true,
      defaultPermissions: SYSTEM_PERMISSIONS.doctor_findings,
    },
    SYSTEM_ACTOR,
  );
}

function scrub(value: unknown): string {
  return redactSensitive(String(value ?? ''));
}

/**
 * Field NAMES only. A caller that passes `field=value` by accident must not
 * turn a finding record into the republishing surface the whole feature exists
 * to avoid.
 */
function fieldNames(names: string[] | undefined): string[] | undefined {
  if (!names?.length) return undefined;
  const out = Array.from(
    new Set(
      names
        .map((n) => scrub(String(n).split('=')[0]).trim().slice(0, 120))
        .filter((n) => n.length > 0),
    ),
  );
  return out.length ? out : undefined;
}

function stickyStatus(prev: FindingStatus | undefined, next: FindingStatus): FindingStatus {
  if (prev && HUMAN_VERDICTS.includes(prev) && OBSERVED_ONLY.includes(next)) return prev;
  return next;
}

/**
 * Strict read. Tolerates an unseeded collection and a missing key, but lets any
 * other datastore error through: upsertFinding merges onto this, and swallowing
 * a transient read failure would silently reset a finding's occurrence history.
 */
async function readFinding(key: string): Promise<DoctorFindingData | null> {
  if (!(await getCollectionBySlug(COLLECTIONS.doctorFindings))) return null;
  try {
    const rec = await getRecordByKey(COLLECTIONS.doctorFindings, key, SYSTEM_ACTOR);
    return rec.data as unknown as DoctorFindingData;
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') return null;
    throw err;
  }
}

/** One finding by key, or null when the collection or the record is absent. */
export async function getFinding(key: string): Promise<DoctorFindingData | null> {
  try {
    return await readFinding(key);
  } catch (err) {
    console.error('[workflowdoctor] getFinding failed:', errMsg(err));
    return null;
  }
}

/**
 * Merge one observation into the store.
 *
 * The key is derived from the signature EXACTLY as passed, so a caller that
 * computes `findingKey()` itself for its seen-set gets the same string back;
 * redaction applies to the stored text only.
 */
export async function upsertFinding(input: FindingInput): Promise<DoctorFindingData> {
  const key = findingKey(input.workflowId, input.nodeId ?? null, input.signature);
  const existing = await readFinding(key);
  const now = new Date().toISOString();
  const seen = Math.max(0, Math.round(Number(input.occurrences ?? 1) || 0));

  const next: DoctorFindingData = {
    workflowId: input.workflowId,
    workflowName: input.workflowName,
    canvasSlug: input.canvasSlug ?? null,
    nodeId: input.nodeId ?? null,
    nodeType: input.nodeType ?? null,
    nodeLabel: input.nodeLabel ?? null,
    signature: scrub(input.signature),
    fixKind: input.fixKind,
    status: stickyStatus(existing?.status, input.status),
    occurrences: (existing?.occurrences ?? 0) + seen,
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
    lastRunId: input.runId ?? existing?.lastRunId ?? null,
    symptom: scrub(input.symptom),
    cause: scrub(input.cause),
    causeSource: input.causeSource,
    fix: scrub(input.fix),
    lintIssues: input.lintIssues ?? existing?.lintIssues ?? [],
    sensitiveFields: fieldNames(input.sensitiveFields) ?? existing?.sensitiveFields,
    // Stored raw: this is a revert payload, not a display surface, and fix.ts
    // only populates it once hasSensitive() has cleared the whole config.
    beforeImage: input.beforeImage ?? existing?.beforeImage,
    verifyBefore: input.verifyBefore ?? existing?.verifyBefore,
    verifyAfter: input.verifyAfter ?? existing?.verifyAfter,
    updatedAt: now,
  };

  await upsertRecord(COLLECTIONS.doctorFindings, { key, data: asData(next) }, SYSTEM_ACTOR);
  return next;
}

/** Newest-updated first. Tolerates a not-yet-seeded collection. */
export async function listFindings(opts: ListFindingsOptions = {}): Promise<DoctorFindingRow[]> {
  try {
    if (!(await getCollectionBySlug(COLLECTIONS.doctorFindings))) return [];
    const { records } = await queryRecords(
      COLLECTIONS.doctorFindings,
      { sort: { field: 'updatedAt', dir: 'desc' }, limit: opts.limit ?? 200 },
      SYSTEM_ACTOR,
    );
    const rows = records.map((r) => ({
      key: r.key ?? r.id,
      data: r.data as unknown as DoctorFindingData,
    }));
    if (!opts.status) return rows;
    const wanted = new Set(Array.isArray(opts.status) ? opts.status : [opts.status]);
    return rows.filter((r) => wanted.has(r.data.status));
  } catch (err) {
    console.error('[workflowdoctor] listFindings failed:', errMsg(err));
    return [];
  }
}

/**
 * Record a human verdict (accept / dismiss / revert) against a finding.
 * Returns the stored record, or null when the key is unknown.
 */
export async function setFindingStatus(
  key: string,
  status: FindingStatus,
  patch?: Partial<DoctorFindingData>,
): Promise<DoctorFindingData | null> {
  const existing = await readFinding(key);
  if (!existing) return null;

  const merged: DoctorFindingData = {
    ...existing,
    ...patch,
    status,
    updatedAt: new Date().toISOString(),
  };
  // A patch carries free text (a revert note, a re-worded fix), so it goes
  // through the same scrub as a fresh observation.
  merged.signature = scrub(merged.signature);
  merged.symptom = scrub(merged.symptom);
  merged.cause = scrub(merged.cause);
  merged.fix = scrub(merged.fix);
  merged.sensitiveFields = fieldNames(merged.sensitiveFields);

  await upsertRecord(COLLECTIONS.doctorFindings, { key, data: asData(merged) }, SYSTEM_ACTOR);
  return merged;
}

/**
 * Close every open finding this run did NOT see again, and return how many.
 *
 * This is the only way a fixed problem stops being reported: the doctor cannot
 * prove a fix worked, it observes that the signature stopped arriving. Findings
 * a human has already ruled on are never reopened or closed here.
 */
export async function resolveStaleFindings(
  seenKeys: Iterable<string>,
  runId: string,
): Promise<number> {
  const seen = new Set(seenKeys);
  const rows = await listFindings({ limit: SWEEP_LIMIT });
  const now = new Date().toISOString();
  let resolved = 0;

  for (const row of rows) {
    if (seen.has(row.key)) continue;
    if (!OPEN_STATUSES.includes(row.data.status)) continue;
    const next: DoctorFindingData = {
      ...row.data,
      status: 'resolved',
      lastRunId: runId,
      updatedAt: now,
    };
    try {
      await upsertRecord(COLLECTIONS.doctorFindings, { key: row.key, data: asData(next) }, SYSTEM_ACTOR);
      resolved++;
    } catch (err) {
      console.error('[workflowdoctor] resolveStaleFindings upsert failed:', errMsg(err));
    }
  }
  return resolved;
}
