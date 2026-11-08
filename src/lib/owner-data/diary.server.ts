// src/lib/owner-data/diary.server.ts
//
// The owner's diary: the calendar through daydream's own reader, so an event
// he excluded ("PE days are kit reminders, not time") never reaches a prompt.
// Shared by the think loop (`$lib/daydream/think/reads` re-exports it) and
// chat's `diary` tool (`./chat-tools`) — overhaul plan 2026-10-28, P2-2.

function query(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, 80) : '';
}

export async function diaryTool(args: Record<string, unknown>): Promise<string> {
  const from = typeof args.from === 'string' && args.from.trim() ? args.from.trim() : 'today';
  const to = typeof args.to === 'string' && args.to.trim() ? args.to.trim() : '+14d';
  const q = query(args.query).toLowerCase();
  const [{ readCalendar }, { loadExclusionSet }] = await Promise.all([
    import('$lib/calendar/read'),
    import('$lib/calendar/store'),
  ]);
  const read = await readCalendar({ dateRangeStart: from, dateRangeEnd: to }, await loadExclusionSet());
  if (!read.available) return `The calendar could not be read (${read.error ?? 'unavailable'}). Treat the diary as unknown, never as empty.`;
  const events = read.events.filter((e) => !q || `${e.title} ${e.location ?? ''}`.toLowerCase().includes(q)).slice(0, 60);
  const lines = [`Diary ${from} to ${to}${q ? `, matching "${q}"` : ''}: ${events.length} event(s).`];
  for (const e of events) {
    lines.push(`  ${e.start.slice(0, 16).replace('T', ' ')}${e.end ? `–${e.end.slice(11, 16)}` : ''} ${e.title}${e.location ? ` @ ${e.location}` : ''}${e.calendar ? ` [${e.calendar}]` : ''}`);
  }
  return lines.join('\n');
}
