import { db } from '$lib/db';
import { jkaiAnswerQuality } from '$lib/db/schema';
import { sql } from 'drizzle-orm';
import type { AnswerAssessment } from './answer';
export interface QualityRecord {
  jobId: string; conversationId?: string | null; policyVersion: number; promptHash: string;
  model: string; taskClass: string; assessment?: AnswerAssessment; elapsedMs: number;
  firstTool?: string; firstSuccessfulTool?: string; schemaErrors: number; evidenceCount: number;
}
export async function recordAnswerQuality(record: QualityRecord) {
  try { await db.insert(jkaiAnswerQuality).values({ id: record.jobId, policyVersion: record.policyVersion,
    taskClass: record.taskClass, assessment: record.assessment ?? null, details: record as unknown as Record<string, unknown>,
  }).onConflictDoNothing(); } catch (err) { console.warn('[quality] could not retain assessment', err instanceof Error ? err.message : err); }
}
export interface QualityCohort { taskClass: string; samples: number; support: number; completion: number }
export function compareQuality(before: QualityCohort[], after: QualityCohort[]): 'pass' | 'regressed' | 'insufficient' {
  if (!before.length || !after.length) return 'insufficient';
  for (const cohort of after) {
    const baseline = before.find(b => b.taskClass === cohort.taskClass);
    if (!baseline || baseline.samples < 10 || cohort.samples < 10) return 'insufficient';
    if (cohort.support < baseline.support - 0.02 || cohort.completion < baseline.completion - 0.02) return 'regressed';
  }
  if (before.some(b => !after.some(a => a.taskClass === b.taskClass))) return 'insufficient';
  return 'pass';
}
export async function assessPolicyQuality(version: number, startedAt: string): Promise<'pass' | 'regressed' | 'insufficient'> {
  try {
    const read = async (after: boolean) => {
      const result = await db.execute(sql`
        select task_class as "taskClass", count(*)::int as samples,
          avg((assessment->>'supported')::boolean::int)::float as support,
          avg((assessment->>'complete')::boolean::int)::float as completion
        from ${jkaiAnswerQuality}
        where assessment->>'supported' in ('true','false') and assessment->>'complete' in ('true','false')
          and ${after ? sql`created_at >= ${startedAt}::timestamptz and policy_version = ${version}`
            : sql`created_at < ${startedAt}::timestamptz and created_at >= ${startedAt}::timestamptz - interval '30 days'`}
        group by task_class`);
      return result.rows as unknown as QualityCohort[];
    };
    const [before, after] = await Promise.all([read(false), read(true)]);
    return compareQuality(before, after);
  } catch { return 'insufficient'; }
}
