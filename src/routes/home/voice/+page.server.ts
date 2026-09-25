import type { PageServerLoad } from './$types';
import { emptyVoiceSummary, searchUtterances, voiceSummary } from '$lib/alexa/store.server';
import { errMsg } from '$lib/daydream/types';

// Owner-gated by hooks — nothing under /home is a public path, and this is the
// whole household's speech, the children's included. Was /jkai/voice.
//
// The log ships the newest LOG_ROWS rows of the window and the page filters
// them in the browser: a family talks to Alexa a few dozen times a day, so a
// month is a few hundred short rows, and filtering on the page is instant. The
// numbers above the log come from the summary, which covers the whole window
// regardless — the note under the table says so when the two differ.

const WINDOWS = [7, 30, 90, 365] as const;
const LOG_ROWS = 500;

/** Every Europe/London day from `from` to today, so a quiet day is a zero, not a gap. */
function daysBetween(from: Date, to: Date): string[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  const out = new Set<string>();
  for (let t = from.getTime(); t <= to.getTime(); t += 3_600_000 * 6) out.add(fmt.format(new Date(t)));
  out.add(fmt.format(to));
  return [...out];
}

export const load: PageServerLoad = async ({ url }) => {
  const asked = Number(url.searchParams.get('days'));
  const days = (WINDOWS as readonly number[]).includes(asked) ? asked : 30;
  try {
    const summary = await voiceSummary({ days });
    const rows = await searchUtterances({ from: new Date(summary.window.from), limit: LOG_ROWS });
    const byDay = new Map(summary.byDay.map((d) => [d.key, d.n]));
    const series = daysBetween(new Date(summary.window.from), new Date(summary.window.to)).map((day) => ({
      label: day,
      value: byDay.get(day) ?? 0,
    }));
    return { days, windows: [...WINDOWS], summary, series, rows, logCap: LOG_ROWS, loadError: null as string | null };
  } catch (err) {
    console.error('[alexa] voice page load failed:', errMsg(err));
    return {
      days,
      windows: [...WINDOWS],
      summary: emptyVoiceSummary(days),
      series: [] as { label: string; value: number }[],
      rows: [] as Awaited<ReturnType<typeof searchUtterances>>,
      logCap: LOG_ROWS,
      loadError: errMsg(err),
    };
  }
};
