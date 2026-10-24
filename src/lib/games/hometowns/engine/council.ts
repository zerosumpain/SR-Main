// The County Council (WP3, spec §8.9): one question each Sunday, open until
// the next Sunday's Regional Day; one vote per town, abstaining allowed; ties
// go to the youngest mayor (the order parents set in settings: no birthdates
// are stored). Archived towns neither vote nor count in the youngest-mayor
// order (A33). The result takes effect from the Regional Day that closes it.

import { GREAT_WORKS } from './content';
import { isActive, regionOf } from './region-state';
import type { CountyState, RegionalContext } from './types';

export const QUESTIONS: Readonly<Record<string, readonly string[]>> = {
  greatWork: GREAT_WORKS.map((g) => g.id),
  commuterRule: ['workTownKeeps', 'fairShare', 'halfAndHalf'],
  cleanAir: ['yes', 'no'],
  countyTrail: ['yes', 'no'],
  festivalTheme: ['concert', 'foodFair', 'sports'],
  flagColours: ['blue', 'green', 'red', 'gold'],
  nextTheme: ['founders', 'ageOfRail'],
};

/** The weeks' rotation after the season's first week (which always asks for the Great Work). */
const ROTATION = ['commuterRule', 'festivalTheme', 'cleanAir', 'countyTrail', 'flagColours'] as const;

/** Which question opens for season week `w` (1-based: the week about to start) of `weeks`. */
export function questionFor(w: number, weeks: number): string {
  if (w <= 1) return 'greatWork';
  if (w >= weeks) return 'nextTheme';
  return ROTATION[(w - 2) % ROTATION.length];
}

/** The winning option index, or null when nobody voted. Ties go to the youngest mayor who voted for one of them. */
export function tally(c: CountyState): number | null {
  const q = c.council;
  const counts = new Array<number>(q.options.length).fill(0);
  for (let i = 0; i < c.towns.length; i++) {
    const v = q.votes[i];
    if (v === null || v === undefined || !isActive(c.towns[i])) continue;
    if (v >= 0 && v < counts.length) counts[v] += 1;
  }
  const top = Math.max(0, ...counts);
  if (top === 0) return null;
  const tied = counts.map((n, k) => (n === top ? k : -1)).filter((k) => k >= 0);
  if (tied.length === 1) return tied[0];
  for (const seat of c.settings.youngestOrder) {
    const i = c.towns.findIndex((t) => t.seat === seat);
    if (i < 0 || !isActive(c.towns[i])) continue;
    const v = q.votes[i];
    if (v !== null && v !== undefined && tied.includes(v)) return v;
  }
  return tied[0];
}

/** Applies a closed question's result to the county. */
function apply(c: CountyState, question: string, choice: number): void {
  const g = regionOf(c);
  const opt = QUESTIONS[question]?.[choice];
  if (opt === undefined) return;
  switch (question) {
    case 'greatWork':
      g.greatWorkChoice = opt;
      break;
    case 'commuterRule':
      g.commuterRule = choice;
      break;
    case 'cleanAir':
      g.cleanAir = opt === 'yes';
      break;
    case 'countyTrail':
      g.countyTrail = opt === 'yes';
      break;
    case 'festivalTheme':
      g.festivalTheme = opt;
      break;
    case 'flagColours':
      g.flag = choice;
      break;
    case 'nextTheme':
      g.nextTheme = opt;
      break;
  }
}

/** Closes this week's question (if any) and opens the next. Returns the closed result for the Gazette. */
export function turnCouncil(c: CountyState, r: RegionalContext, nextWeek: number, weeks: number): { question: string; choice: number } | null {
  const q = c.council;
  let closed: { question: string; choice: number } | null = null;
  if (q.question) {
    const choice = tally(c);
    if (choice !== null) {
      apply(c, q.question, choice);
      q.results.push({ question: q.question, choice, day: r.dayIndex });
      while (q.results.length > 12) q.results.shift();
      closed = { question: q.question, choice };
    }
  }
  const next = questionFor(nextWeek, weeks);
  q.question = next;
  q.options = [...QUESTIONS[next]];
  q.votes = c.towns.map(() => null);
  q.closesDay = r.dayIndex + 7;
  return closed;
}
