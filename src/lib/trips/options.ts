// src/lib/trips/options.ts
//
// Choices with trade-offs (red team 2026-10-15, proposal C). When a request
// has more than one good answer — "what shall we do this afternoon?",
// "somewhere for dinner", "it's raining" — the planner does not change the
// plan: it offers two or three options. Each is placed on the map and dry-run
// against that day like an idea (./ideas `verifyIdea`), so the card says what
// it really costs the day: when it would be, the walk in and out, what it
// pushes out — beside the planner's own indoor / children / price notes.
// Choosing one adds it through the ordinary paths. PURE: ./options.server
// does the placing and checking.

import { DAY_STAGES, type DayStage, type LocalDate, type TravelMode, type WishDraft } from './model';
import type { Verdict } from './ideas';

/** What the planner offers, before it is checked. */
export interface OptionDraft {
  date: LocalDate;
  stage: DayStage;
  title: string;
  placeQuery: string;
  durationMin: number;
  why: string;
  indoor: boolean | null;
  kidFriendly: boolean | null;
  costText: string | null;
}

/** An option checked against the day: what the phone shows as a card. */
export interface PlanOption {
  id: string;
  date: LocalDate;
  stage: DayStage;
  title: string;
  why: string;
  /** "14:10–15:10 · 12 min walk in, 8 min on" — from the solver. */
  fit: string;
  indoor: boolean | null;
  kidFriendly: boolean | null;
  costText: string | null;
  /** The wish choosing it adds (placed). */
  wish: WishDraft;
  verdict: Verdict;
}

const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, n) : null);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);

/** The planner's `options`: at most three, each with a date, a part of the day, a title and a place to look up. */
export function readOptionDrafts(raw: unknown): OptionDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: OptionDraft[] = [];
  for (const o of raw) {
    if (!o || typeof o !== 'object') continue;
    const r = o as Record<string, unknown>;
    const date = str(r.date, 10);
    const title = str(r.title, 120);
    const placeQuery = str(r.placeQuery, 200) ?? title;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !title || !placeQuery) continue;
    if (!(DAY_STAGES as readonly unknown[]).includes(r.stage)) continue;
    const minutes = Number(r.durationMin);
    out.push({
      date,
      stage: r.stage as DayStage,
      title,
      placeQuery,
      durationMin: Number.isFinite(minutes) ? Math.min(240, Math.max(15, Math.round(minutes))) : 60,
      why: str(r.why, 300) ?? '',
      indoor: bool(r.indoor),
      kidFriendly: bool(r.kidFriendly),
      costText: str(r.costText, 60),
    });
    if (out.length === 3) break;
  }
  return out;
}

const hhmm = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const MODE_WORD: Record<TravelMode, string> = { walk: 'walk', transit: 'by public transport', taxi: 'by taxi', drive: 'drive', cycle: 'cycle' } as Record<TravelMode, string>;

/** What the option does to the day, in one line, from the solver's verdict. */
export function optionFit(v: Verdict): string {
  const parts: string[] = [];
  if (v.arriveMin != null && v.departMin != null) parts.push(`${hhmm(v.arriveMin)}–${hhmm(v.departMin)}`);
  if (v.legInMin != null) parts.push(`${Math.round(v.legInMin)} min ${MODE_WORD[v.legInMode ?? 'walk'] ?? 'there'} in`);
  if (v.legOutMin != null) parts.push(`${Math.round(v.legOutMin)} min on`);
  if (v.pushesOut.length) parts.push(`would push out ${v.pushesOut.join(', ')}`);
  for (const m of v.moves.slice(0, 2)) parts.push(`moves ${m.title} to ${m.to}`);
  return parts.join(' · ') || (v.fits ? 'Fits the day' : (v.reason ?? 'Does not fit'));
}
