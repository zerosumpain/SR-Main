// The County Week (WP3, spec §8.9, §8.10, A22): Sunday's Regional Day adds
// the County Fair awards and Mentions, the Council result and next question,
// the Goals board, the Development Fund payout, the festival winner,
// friendship weeks, and the Gazette issue (data only).
//
// Seasons are counted in County Weeks, not wall-clock days (A22): six of
// them make a season, so a pause or a nap lengthens it. The County Week runs
// at the first Regional Day that falls on a Sunday (Europe/London); if a
// pause or nap swallowed the Sunday, it runs once at the first Regional Day
// after the county wakes, scoring over the days that actually ran. In
// dev-clock mode every 7th Regional Day is a County Week.
//
// Great Works are M3: the season's first question still asks the family to
// choose one, and the choice waits in region.greatWorkChoice for greatworks.ts.

import { londonDay, weekday } from './clock';
import { GREAT_WORKS } from './content';
import { population } from './core';
import { awardScores, bestCategory, drawCategories, pickAwards, type Entrant } from './awards';
import { turnCouncil } from './council';
import { payFund } from './fund';
import { buildGazette, type WeekNews } from './gazette';
import { newBoard, rewardFor, scoreBoard } from './goals';
import { countFriendship } from './regional-day';
import { emptyWeek, isActive, MAX_TOWNS, pp, regionOf, rp } from './region-state';
import { BUILDINGS } from './content';
import { STARS, type CountyState, type RegionalContext } from './types';

const THEMES = ['founders', 'ageOfRail'] as const;
const FUN = STARS.indexOf('fun');
const AROUND = STARS.indexOf('around');

/** Is this Regional Day a County Week (A22)? A Sunday, or the first day after a swallowed one. */
export function countyWeekDue(c: CountyState, r: RegionalContext): boolean {
  if (c.devTickMs !== null) return r.countyWeek;
  const g = regionOf(c);
  const today = londonDay(r.at);
  const last = c.lastRegionalDayAt > 0 ? londonDay(c.lastRegionalDayAt) : today - 1;
  const sunday = today - weekday(today);
  return sunday > last && sunday > g.lastWeekDay;
}

/** The festival bid score (§8.6): venue capacity + beds + transit + Fun. */
export function festivalScore(c: CountyState, i: number): number {
  const t = c.towns[i];
  let venues = 0;
  for (const b of t.buildings) venues += BUILDINGS[b[0]]?.visitorCap ?? 0;
  const beds = Math.max(0, t.marketMemo?.bedDemand ?? 0);
  return venues / 100 + beds / 100 + (t.perceived[AROUND] ?? 0) + (t.perceived[FUN] ?? 0);
}

/** STEP §8.3 8 (WP3): the County Week, when due. */
export function stepCountyWeek(c: CountyState, r: RegionalContext): void {
  const g = regionOf(c);
  const due = countyWeekDue(c, r);
  // A make-up Sunday (A22) is a County Week too, and a Sunday already counted is not.
  r.report.countyWeek = due;
  if (!due) return;
  const q = rp(c);
  const p = pp(c);
  g.lastWeekDay = c.devTickMs !== null ? r.dayIndex : londonDay(r.at);
  c.awards.week += 1;
  const week = c.awards.week;
  g.seasonWeek += 1;
  const seasonEnd = g.seasonWeek >= q.seasonWeeks;

  // ---- County Fair awards (holiday towns earn no award points, §2.4) ----
  const entrants: Entrant[] = [];
  for (let i = 0; i < c.towns.length; i++) {
    const t = c.towns[i];
    const w = g.week[i];
    if (!isActive(t) || !w || w.days === 0 || w.holidayDays * 2 > w.days) continue;
    entrants.push({ town: i, pop: population(t), scores: awardScores(w) });
  }
  const cats = drawCategories(c.seed, week, q.awardsPerWeek);
  const awards = pickAwards(entrants, cats, p.fairness.awardsPerTownMax);
  for (const a of awards) {
    c.awards.history.push({ town: a.town, award: a.award, week });
    note(c, a.town, r.dayIndex, 'award', { award: a.award });
  }
  // ---- The Mention guarantee: no award for 2 weeks → the Editor's Mention ----
  while (c.awards.dry.length < c.towns.length) c.awards.dry.push(0);
  const mentions: { town: number; award: string }[] = [];
  for (let i = 0; i < c.towns.length; i++) {
    if (!isActive(c.towns[i])) continue;
    if (awards.some((a) => a.town === i)) {
      c.awards.dry[i] = 0;
      continue;
    }
    c.awards.dry[i] += 1;
    if (c.awards.dry[i] >= p.fairness.mentionAfterWeeks) {
      const award = entrants.some((e) => e.town === i) ? bestCategory(entrants, i) : 'kindestNeighbour';
      mentions.push({ town: i, award });
      note(c, i, r.dayIndex, 'mention', { award });
      c.awards.dry[i] = 0;
    }
  }
  while (c.awards.history.length > 60) c.awards.history.shift();

  // ---- The Council: close this week's question, open the next ----
  const nextWeek = seasonEnd ? 1 : g.seasonWeek + 1;
  const council = turnCouncil(c, r, nextWeek, q.seasonWeeks);

  // ---- The Goals board: score it, reward it, refresh it ----
  const done = c.goals.goals.length ? scoreBoard(c) : 0;
  const reward = c.goals.goals.length ? rewardFor(c, done) : null;
  if (reward === 'festivalWeekend' || reward === 'decorations' || reward === 'statue') g.festivalWeekend = r.dayIndex + 1;
  if (reward === 'decorations' || reward === 'statue')
    for (let i = 0; i < c.towns.length; i++) if (isActive(c.towns[i])) note(c, i, r.dayIndex, 'reward', { reward });
  if (reward === 'statue') for (const t of c.towns) if (isActive(t) && !t.trophies.includes('countyStatue')) t.trophies.push('countyStatue');
  const total = c.goals.goals.length;
  c.goals = newBoard(c, week + 1);

  // ---- The Development Fund pays out to towns below the median ----
  const fund = payFund(c);
  fund.forEach((x, i) => {
    if (x > 0) note(c, i, r.dayIndex, 'fundGrant', { amount: x });
  });

  // ---- The festival: the best bid hosts next week ----
  let host = -1;
  let best = -Infinity;
  for (let i = 0; i < c.towns.length; i++) {
    if (!g.bids[i] || !isActive(c.towns[i])) continue;
    const s = festivalScore(c, i);
    if (s > best || (s === best && population(c.towns[i]) < population(c.towns[host]))) {
      best = s;
      host = i;
    }
  }
  c.festival = host >= 0 ? { host, day: r.dayIndex + 1, kind: g.bids[host] } : null;
  if (host >= 0) note(c, host, r.dayIndex, 'festivalHost', { kind: g.bids[host] });

  // ---- Friendship weeks; the weekly caps reset ----
  countFriendship(c);

  // ---- The Gazette (data) ----
  const news: WeekNews = {
    week,
    season: c.season.n,
    seasonWeek: g.seasonWeek,
    awards,
    mentions,
    council,
    nextQuestion: c.council.question,
    goals: { done, total, reward },
    fund,
    festival: c.festival ? { host: c.festival.host, kind: c.festival.kind } : null,
    seasonEnd,
  };
  c.gazette.push(buildGazette(c, r, news));
  while (c.gazette.length > 2) c.gazette.shift();

  // ---- A new week ----
  g.week = c.towns.map((t) => emptyWeek(t));
  g.adverts = new Array<number>(MAX_TOWNS * MAX_TOWNS).fill(0);
  g.pranks = new Array<number>(MAX_TOWNS * MAX_TOWNS).fill(0);
  g.bids = c.towns.map(() => '');
  g.weekStories = [];

  if (seasonEnd) endSeason(c, r);
}

/**
 * A season ends after its sixth County Week (A22): a superlative trophy for
 * every mayor, the scoreboard reset, holiday allowances renewed, the next
 * theme, and the next Great Work menu. A new params version would be adopted
 * here, announced as "New rules this season" (§8.10, A38): v1 has only one.
 */
function endSeason(c: CountyState, r: RegionalContext): void {
  const g = regionOf(c);
  const n = c.season.n;
  for (let i = 0; i < c.towns.length; i++) {
    const t = c.towns[i];
    if (t.archived) continue;
    const mine = c.awards.history.filter((h) => h.town === i);
    const counts = new Map<string, number>();
    for (const h of mine) counts.set(h.award, (counts.get(h.award) ?? 0) + 1);
    let top = 'founder';
    let most = 0;
    for (const [k, v] of counts) if (v > most) (most = v), (top = k);
    t.trophies.push(`season${n}.${top}`);
    while (t.trophies.length > 40) t.trophies.shift();
    t.holiday.usedDays = 0;
  }
  c.awards.history = [];
  const next = g.nextTheme ?? THEMES[n % THEMES.length];
  c.season = { n: n + 1, theme: next, startedDay: r.dayIndex + 1, startMonth: r.month, menu: GREAT_WORKS.map((x) => x.id) };
  g.nextTheme = null;
  g.seasonWeek = 0;
}

function note(c: CountyState, i: number, day: number, kind: string, data: Record<string, number | string>): void {
  const t = c.towns[i];
  if (!t || t.archived) return;
  t.inbox.push({ id: `${kind}.${day}.${t.inbox.length}`, kind, day, from: null, data });
  while (t.inbox.length > 40) t.inbox.shift();
}
