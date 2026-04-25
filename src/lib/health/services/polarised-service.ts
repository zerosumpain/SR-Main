import { db } from '$lib/db';
import { whoopWorkouts } from '$lib/db/schema';
import { gte, asc } from 'drizzle-orm';
import { computePolarised, type ZoneDurations } from '$lib/health/analytics/polarised';

export async function getPolarised() {
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const rows = await db
    .select({
      z0: whoopWorkouts.zoneZero,
      z1: whoopWorkouts.zoneOne,
      z2: whoopWorkouts.zoneTwo,
      z3: whoopWorkouts.zoneThree,
      z4: whoopWorkouts.zoneFour,
      z5: whoopWorkouts.zoneFive,
    })
    .from(whoopWorkouts)
    .where(gte(whoopWorkouts.startDate, since))
    .orderBy(asc(whoopWorkouts.startDate));

  const zones: ZoneDurations[] = rows.map((r) => ({
    z0: r.z0, z1: r.z1, z2: r.z2, z3: r.z3, z4: r.z4, z5: r.z5,
  }));
  return computePolarised(zones);
}
