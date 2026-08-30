// Number and date formatting for the redesigned /health owner pages.
//
// One copy, because the same figure appears in two registers on this page — a
// 40px Archivo Black value and a 12px mono footnote — and the two disagreeing
// about how many decimals a ratio has is the sort of thing nobody sees until
// it is on the live site.

/** `1.4`, `0.62`, `41.2` — a plain fixed-decimal, with no trailing `NaN`. */
export function fixed(value: number | null | undefined, dp = 1): string {
  return Number.isFinite(value) ? (value as number).toFixed(dp) : '—';
}

/** Rounded to a whole number. `—` when there is nothing to round. */
export function whole(value: number | null | undefined): string {
  return Number.isFinite(value) ? String(Math.round(value as number)) : '—';
}

/** `+3`, `−0.14`. A real minus sign, not a hyphen — this is display copy. */
export function signed(value: number | null | undefined, dp = 0): string {
  if (!Number.isFinite(value)) return '—';
  const v = value as number;
  const body = Math.abs(v).toFixed(dp);
  if (v > 0) return `+${body}`;
  if (v < 0) return `−${body}`;
  return dp > 0 ? `0.${'0'.repeat(dp)}` : '0';
}

/** `1st`, `2nd`, `63rd` — for the VO₂max percentile. */
export function ordinal(value: number): string {
  const n = Math.round(value);
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const rem10 = n % 10;
  if (rem10 === 1) return `${n}st`;
  if (rem10 === 2) return `${n}nd`;
  if (rem10 === 3) return `${n}rd`;
  return `${n}th`;
}

/** `1h48m`, `48m`. Seconds in, a duration a human would say out loud. */
export function duration(seconds: number | null | undefined): string {
  if (!Number.isFinite(seconds) || (seconds as number) <= 0) return '—';
  const total = Math.round(seconds as number);
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * `30 AUG 2026` from a `YYYY-MM-DD`.
 *
 * Parsed by SPLITTING THE STRING, never by `new Date(iso)`: the dates on this
 * page are local calendar days computed server-side, and putting one through a
 * UTC-midnight Date and back out through a local getter moves it a day either
 * side of midnight depending on where the reader is.
 */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  const month = MONTHS[Number(m) - 1];
  if (!month || !y || !d) return iso;
  return `${Number(d)} ${month} ${y}`;
}

/** `30 AUG` — the same, without the year, for a within-year reference. */
export function shortDay(iso: string | null | undefined): string {
  const full = shortDate(iso);
  return full === '—' || full === iso ? full : full.split(' ').slice(0, 2).join(' ');
}

/** `hh:mm` from minutes past midnight, wrapping over the day boundary. */
export function clockFromMinutes(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** `1h18m` from a signed count of hours — the circadian drift, spelled out. */
export function hoursAndMinutes(hours: number): string {
  const totalMin = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h${String(m).padStart(2, '0')}m`;
}

/** ONE, TWO, … NINE for the mono kickers, which never print a numeral. */
const WORDS = ['NO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];
export function countWord(n: number): string {
  return WORDS[n] ?? String(n);
}
