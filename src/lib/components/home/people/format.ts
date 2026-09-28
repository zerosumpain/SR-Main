// Formatting shared by the /home/people dashboard. Every clock is London's:
// the server runs UTC and "leaves 08:24" is a fact about the family's day.

const CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' });

export const clock = (t: string | number | Date) => CLOCK.format(new Date(t));
export const dayLabel = (t: string | number | Date) => DAY.format(new Date(t));

/** 17 → "17 min", 95 → "1 h 35 min". */
export function mins(n: number): string {
  const m = Math.round(n);
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

/** 1500 → "25 h" (headline totals). */
export const hours = (minutes: number) => `${Math.round(minutes / 60)} h`;

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "weekday" → "weekdays", with the count: "9 of 17 weekdays". */
export const ofDays = (days: number, of: number, type: 'weekday' | 'weekend' | null) =>
  type ? `${days} of ${of} ${type === 'weekday' ? 'weekdays' : 'weekend days'}` : `${days} similar trips`;

/** Minute of the day as HH:MM. */
export const hhmm = (m: number) => {
  const v = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
