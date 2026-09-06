import { z } from 'zod';
import { HEALTH_TIMEZONE, localToday } from '$lib/constants/health-day';
import { HERO_ACTIVITY_DEFAULTS, type HeroActivityRules, type HeroSlot } from '$lib/constants/hero-slots';

export const heroActivitySchema = z.object({
  averageSteps: z.number().int().min(1).max(100000).default(HERO_ACTIVITY_DEFAULTS.averageSteps),
  veryActiveSteps: z.number().int().min(2).max(100000).default(HERO_ACTIVITY_DEFAULTS.veryActiveSteps),
}).strict().refine(r => r.veryActiveSteps > r.averageSteps, { message: 'Very active must start above averagely active.' });

/** These are display rules, not clinical activity classifications. */
export function activitySlot(steps: number | null, rules: HeroActivityRules, now = new Date()): HeroSlot {
  if (steps === null || !Number.isFinite(steps) || steps < 0) return 'default';
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: HEALTH_TIMEZONE, weekday: 'short' }).format(now);
  const period = day === 'Sat' || day === 'Sun' ? 'weekend' : 'weekday';
  const level = steps >= rules.veryActiveSteps ? 'very-active' : steps >= rules.averageSteps ? 'average' : 'inactive';
  return `${period}-${level}`;
}

/** London midnight boundaries, including 23/25-hour daylight-saving days. */
export function heroDayBounds(now = new Date()) {
  const midnight = Date.parse(localToday(now) + 'T00:00:00Z');
  function toLondonMidnight(utcMidnight: number) {
    let result = utcMidnight;
    for (let i = 0; i < 2; i++) {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: HEALTH_TIMEZONE, timeZoneName: 'longOffset',
      }).formatToParts(new Date(result));
      const offset = parts.find(p => p.type === 'timeZoneName')!.value;
      const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offset);
      const minutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1) : 0;
      result = utcMidnight - minutes * 60000;
    }
    return result / 1000;
  }
  return { start: toLondonMidnight(midnight), end: toLondonMidnight(midnight + 86400000) };
}
