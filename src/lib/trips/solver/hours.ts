// src/lib/trips/solver/hours.ts
//
// A practical subset of OSM `opening_hours`: weekday selectors (`Mo-Fr`,
// `Tu,Th`, wrapping `Fr-Mo`), one or more time spans (`09:00-12:00,14:00-18:00`),
// `off`/`closed`, `24/7`, rules joined by `;` (later rules win for their days,
// as in OSM) and `, ` before a new weekday selector. `PH` (public holiday)
// rules are skipped — we do not know the holidays; use `closedDates` instead.
// Anything else (months, week numbers, `sunrise`, `+`, comments) makes the
// whole text unparseable → null, which the solver treats as "unknown".

import type { DayHours, Facts, LocalDate } from '../model';
import { isoWeekday, type IsoWeekday } from './calendar';

type Hours = NonNullable<Facts['hours']>;

const DAY_CODES: Record<string, IsoWeekday> = {
  Mo: 1,
  Tu: 2,
  We: 3,
  Th: 4,
  Fr: 5,
  Sa: 6,
  Su: 7,
};
const ALL_DAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

/** Parse `HH:MM` into minutes; `24:00` allowed. */
function parseClock(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/** Returns the days a selector covers, [] for a PH-only selector, null if unparseable. */
function parseSelector(text: string): IsoWeekday[] | null {
  const days = new Set<IsoWeekday>();
  for (const part of text.split(',')) {
    if (part === 'PH') continue;
    const range = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(part);
    if (!range) return null;
    const from = DAY_CODES[range[1]];
    const to = range[2] ? DAY_CODES[range[2]] : from;
    for (let d = from; ; d = ((d % 7) + 1) as IsoWeekday) {
      days.add(d);
      if (d === to) break;
    }
  }
  return ALL_DAYS.filter((d) => days.has(d));
}

/** Parse time spans; [] for off/closed, null if unparseable. Overnight spans close at midnight. */
function parseSpans(text: string): DayHours | null {
  if (text === 'off' || text === 'closed') return [];
  const spans: DayHours = [];
  for (const part of text.split(',')) {
    const m = /^([\d:]+)-([\d:]+)$/.exec(part);
    if (!m) return null;
    const open = parseClock(m[1]);
    let close = parseClock(m[2]);
    if (open === null || close === null) return null;
    if (close <= open) close = 1440; // past midnight: the part after midnight is ignored
    spans.push({ openMin: open, closeMin: close });
  }
  spans.sort((a, b) => a.openMin - b.openMin || a.closeMin - b.closeMin);
  const merged: DayHours = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.openMin <= last.closeMin) last.closeMin = Math.max(last.closeMin, s.closeMin);
    else merged.push({ ...s });
  }
  return merged;
}

/**
 * Parse OSM `opening_hours` into hours by ISO weekday. Days no rule mentions
 * are closed (OSM semantics). Returns null when the text is empty, uses
 * syntax outside the subset, or only has PH rules.
 */
export function parseOpeningHours(text: string | null | undefined): Facts['hours'] {
  if (!text) return null;
  const normalised = text
    .trim()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*,\s*(?=\d)/g, ',')
    .replace(/(Mo|Tu|We|Th|Fr|Sa|Su|PH)\s*,\s*(?=(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/g, '$1,');
  if (!normalised) return null;
  const rules = normalised
    .split(/\s*;\s*/)
    .flatMap((r) => r.split(/,\s+(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)[-,\s])/))
    .map((r) => r.trim())
    .filter(Boolean);
  const hours: Hours = {};
  let any = false;
  for (const rule of rules) {
    if (rule === '24/7') {
      for (const d of ALL_DAYS) hours[d] = [{ openMin: 0, closeMin: 1440 }];
      any = true;
      continue;
    }
    const tokens = rule.split(/\s+/);
    let days: IsoWeekday[] | null;
    let spansText: string;
    if (tokens.length === 1) {
      days = /^[\d:,-]+$|^off$|^closed$/.test(tokens[0]) ? ALL_DAYS : null;
      spansText = tokens[0];
      if (days === null) return null;
    } else if (tokens.length === 2) {
      days = parseSelector(tokens[0]);
      spansText = tokens[1];
    } else {
      return null;
    }
    if (days === null) return null;
    const spans = parseSpans(spansText);
    if (spans === null) return null;
    if (days.length === 0) continue; // PH only
    for (const d of days) hours[d] = spans.map((s) => ({ ...s }));
    any = true;
  }
  if (!any) return null;
  for (const d of ALL_DAYS) if (!hours[d]) hours[d] = [];
  return hours;
}

/**
 * Open windows on a local date: [] = closed (including `closedDates`),
 * null = unknown. Uses `facts.hours`, falling back to parsing the text.
 */
export function windowsOn(facts: Facts | null | undefined, date: LocalDate): DayHours | null {
  if (!facts) return null;
  if (facts.closedDates?.includes(date)) return [];
  const hours = facts.hours ?? parseOpeningHours(facts.openingHoursText);
  if (!hours) return null;
  const day = hours[isoWeekday(date)];
  return day ? day.map((w) => ({ ...w })) : null;
}

/** Whether a place is closed all day on a date (unknown counts as open). */
export function closedOn(facts: Facts | null | undefined, date: LocalDate): boolean {
  const w = windowsOn(facts, date);
  return w !== null && w.length === 0;
}
