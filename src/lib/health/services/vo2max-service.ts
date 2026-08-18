import { db } from '$lib/db';
import { appleHealthMetrics } from '$lib/db/schema';
import { gte, eq, and, asc } from 'drizzle-orm';
import { computeVO2MaxResult, type VO2Sample, type Profile } from '$lib/health/analytics/vo2max-percentile';
import { env } from '$env/dynamic/private';

// Profile for the ACSM age×sex percentile lookup. DOB + sex come from env
// (HEALTH_DOB=YYYY-MM-DD, HEALTH_SEX=male|female) so the real values stay out of
// the repo; age is derived at request time so the percentile never goes stale.
// Falls back to a neutral default when unset.
export function resolveHealthProfile(): Profile {
  const sex: Profile['sex'] = env.HEALTH_SEX === 'female' ? 'female' : 'male';
  const dob = env.HEALTH_DOB;
  let age = 32;
  if (dob && /^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    const [y, m, d] = dob.split('-').map(Number);
    const now = new Date();
    const curM = now.getUTCMonth() + 1;
    const curD = now.getUTCDate();
    age = now.getUTCFullYear() - y - (curM < m || (curM === m && curD < d) ? 1 : 0);
  }
  return { age, sex };
}

export async function getVO2Max() {
  const since = Math.floor(Date.now() / 1000) - 90 * 86400;
  const rows = await db
    .select({ date: appleHealthMetrics.date, value: appleHealthMetrics.value })
    .from(appleHealthMetrics)
    .where(and(eq(appleHealthMetrics.metricName, 'vo2_max'), gte(appleHealthMetrics.date, since)))
    .orderBy(asc(appleHealthMetrics.date));

  const series: VO2Sample[] = rows
    .filter((r) => r.value != null)
    .map((r) => ({ date: new Date(r.date * 1000).toISOString().slice(0, 10), value: (r.value as number) / 100 }));

  return computeVO2MaxResult(series, resolveHealthProfile());
}
