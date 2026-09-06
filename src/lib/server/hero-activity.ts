import { db } from '$lib/db';
import { appleHealthMetrics } from '$lib/db/schema';
import { and, eq, gte, lt } from 'drizzle-orm';
import { getSetting, setSetting } from '$lib/server/models/settings';
import { HERO_ACTIVITY_DEFAULTS } from '$lib/constants/hero-slots';
import { activitySlot, heroActivitySchema, heroDayBounds } from './hero-slot-policy';

const KEY = 'landing.hero.activity';
export async function getHeroActivityRules() {
  const parsed = heroActivitySchema.safeParse(await getSetting(KEY) ?? {});
  return parsed.success ? parsed.data : { ...HERO_ACTIVITY_DEFAULTS };
}
export async function saveHeroActivityRules(value: unknown) {
  await setSetting(KEY, heroActivitySchema.parse(value));
}
export async function getHeroActivity(now = new Date()) {
  const bounds = heroDayBounds(now);
  const [rows, rules] = await Promise.all([
    db.select({ value: appleHealthMetrics.value }).from(appleHealthMetrics)
      .where(and(eq(appleHealthMetrics.metricName, 'step_count'), gte(appleHealthMetrics.date, bounds.start),
        lt(appleHealthMetrics.date, Math.min(bounds.end, Math.floor(now.getTime() / 1000) + 1))))
      .catch(() => []),
    getHeroActivityRules(),
  ]);
  // No reading is different from a recorded zero: missing data uses Default.
  let steps: number | null = null;
  for (const row of rows) {
    if (typeof row.value === 'number' && Number.isFinite(row.value) && row.value >= 0) {
      steps = (steps ?? 0) + Math.round(row.value / 100);
    }
  }
  return { steps, slot: activitySlot(steps, rules, now) };
}
