import { db } from '$lib/db';
import { whoopSleep, whoopCycles, whoopRecovery } from '$lib/db/schema';
import { gte, eq, and, asc } from 'drizzle-orm';
import { realStrain } from '$lib/health/whoop';
import { computeRecoveryDebt, type RecoverySample } from '$lib/health/analytics/recovery-debt';

export async function getRecoveryDebt() {
  const since = Math.floor(Date.now() / 1000) - 14 * 86400;
  const [sleeps, cycles, recoveries] = await Promise.all([
    db.select({
        start: whoopSleep.startDate,
        baselineNeed: whoopSleep.baselineNeed,
        debtNeed: whoopSleep.needFromDebt,
        strainNeed: whoopSleep.needFromStrain,
        inBed: whoopSleep.totalInBed,
        awake: whoopSleep.totalAwake,
        nap: whoopSleep.nap,
      })
      .from(whoopSleep)
      .where(and(gte(whoopSleep.startDate, since), eq(whoopSleep.nap, false)))
      .orderBy(asc(whoopSleep.startDate)),
    db.select({ start: whoopCycles.startDate, strain: whoopCycles.strain })
      .from(whoopCycles)
      .where(gte(whoopCycles.startDate, since))
      .orderBy(asc(whoopCycles.startDate)),
    db.select({ created: whoopRecovery.createdDate, score: whoopRecovery.recoveryScore })
      .from(whoopRecovery)
      .where(gte(whoopRecovery.createdDate, since))
      .orderBy(asc(whoopRecovery.createdDate)),
  ]);

  const byDay = new Map<string, RecoverySample>();

  for (const s of sleeps) {
    const date = new Date(s.start * 1000).toISOString().slice(0, 10);
    const needMs = s.baselineNeed + s.debtNeed + s.strainNeed;
    const actualMs = Math.max(0, s.inBed - s.awake);
    byDay.set(date, {
      date,
      sleepNeedMin: needMs / 60_000,
      sleepActualMin: actualMs / 60_000,
      strain: 0,
      recoveryScore: 0,
    });
  }
  for (const c of cycles) {
    const date = new Date(c.start * 1000).toISOString().slice(0, 10);
    const ent = byDay.get(date) ?? { date, sleepNeedMin: 0, sleepActualMin: 0, strain: 0, recoveryScore: 0 };
    ent.strain = realStrain(c.strain);
    byDay.set(date, ent);
  }
  for (const r of recoveries) {
    const date = new Date(r.created * 1000).toISOString().slice(0, 10);
    const ent = byDay.get(date) ?? { date, sleepNeedMin: 0, sleepActualMin: 0, strain: 0, recoveryScore: 0 };
    ent.recoveryScore = r.score;
    byDay.set(date, ent);
  }

  const series = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  return computeRecoveryDebt(series);
}
