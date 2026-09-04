import { db } from '$lib/db';
import { whoopSleep, whoopCycles, whoopRecovery } from '$lib/db/schema';
import { gte, eq, and, asc } from 'drizzle-orm';
import { realStrain } from '$lib/health/whoop';
import { computeRecoveryDebt, type RecoverySample } from '$lib/health/analytics/recovery-debt';

export async function getRecoveryDebt() {
  // Fetch enough complete sleeps for a seven-night read plus a preceding
  // 21-night personal comparison. The small buffer covers missed sync days.
  const since = Math.floor(Date.now() / 1000) - 35 * 86400;
  const [sleeps, cycles, recoveries] = await Promise.all([
    db.select({
        id: whoopSleep.id,
        start: whoopSleep.startDate,
        startLocal: whoopSleep.startDateLocal,
        baselineNeed: whoopSleep.baselineNeed,
        debtNeed: whoopSleep.needFromDebt,
        strainNeed: whoopSleep.needFromStrain,
        napNeed: whoopSleep.needFromNap,
        light: whoopSleep.totalLight,
        slowWave: whoopSleep.totalSlowWave,
        rem: whoopSleep.totalRem,
        nap: whoopSleep.nap,
      })
      .from(whoopSleep)
      .where(and(gte(whoopSleep.startDate, since), eq(whoopSleep.nap, false)))
      .orderBy(asc(whoopSleep.startDate)),
    db.select({ start: whoopCycles.startDate, startLocal: whoopCycles.startDateLocal, strain: whoopCycles.strain })
      .from(whoopCycles)
      .where(gte(whoopCycles.startDate, since))
      .orderBy(asc(whoopCycles.startDate)),
    db.select({ sleepId: whoopRecovery.sleepId, score: whoopRecovery.recoveryScore })
      .from(whoopRecovery)
      .where(gte(whoopRecovery.createdDate, since))
      .orderBy(asc(whoopRecovery.createdDate)),
  ]);

  const byDay = new Map<string, RecoverySample>();
  const bySleepId = new Map<string, RecoverySample>();

  for (const s of sleeps) {
    // WHOOP persists the offset-bearing local start. Using its leading date
    // keeps a sleep beside the day the wearer experienced instead of moving it
    // across midnight when converted to UTC.
    const date = s.startLocal.slice(0, 10) || new Date(s.start * 1000).toISOString().slice(0, 10);
    // Carried debt is intentionally excluded: adding it to the target and then
    // summing the new gap counts an old shortfall again. WHOOP's nap adjustment
    // is already signed (normally negative), so include it exactly once.
    const freshNeedMs = Math.max(0, s.baselineNeed + s.strainNeed + s.napNeed);
    const actualMs = Math.max(0, s.light + s.slowWave + s.rem);
    const sample = {
      date,
      freshSleepNeedMin: freshNeedMs / 60_000,
      sleepActualMin: actualMs / 60_000,
      whoopDebtAdjustmentMin: Math.max(0, s.debtNeed) / 60_000,
      strain: 0,
      recoveryScore: 0,
    };
    byDay.set(date, sample);
    bySleepId.set(s.id, sample);
  }
  for (const c of cycles) {
    const date = c.startLocal.slice(0, 10) || new Date(c.start * 1000).toISOString().slice(0, 10);
    const ent = byDay.get(date);
    if (!ent) continue;
    ent.strain = realStrain(c.strain);
  }
  for (const r of recoveries) {
    const ent = bySleepId.get(r.sleepId);
    if (!ent) continue;
    ent.recoveryScore = r.score;
  }

  const series = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  return computeRecoveryDebt(series);
}
