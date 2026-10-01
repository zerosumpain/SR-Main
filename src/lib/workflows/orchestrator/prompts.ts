/** "Now", for the user turn (not the system prompt, whose prefix must stay cacheable).
 *  Without it "till 6pm today" cannot become a schedule and the model has to ask (2026-09-25). */
export function withNow(message: string, now = new Date()): string {
  const when = now.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${message}\n\n(Now: ${when}, Europe/London — schedules run in this zone. "Today only" is a cron pinned to today's day-of-month and month.)`;
}
