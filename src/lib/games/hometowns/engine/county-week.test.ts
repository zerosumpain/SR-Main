// WP3 County Week, seasons and the weekly layer (spec §8.9, §8.10, A22, A33,
// A40): at most 2 awards per town with ties to the smaller town, the Mention
// guarantee, the Council's youngest-mayor tie-break, the Development Fund's
// 2× median condition and its payout, 6-week seasons with make-up Sundays,
// the Goals board, a deterministic Gazette, Initiatives, Kingsport and the
// forgotten-county hook.

import { describe, expect, it } from 'vitest';
import { linkAll, multiCounty, nextContext, runDay } from '../../../../../scripts/hometowns/region-kit';
import { AWARD_POOL, pickAwards, type Entrant } from './awards';
import { MS_DAY, londonInstant, weekday, londonDay } from './clock';
import { tally } from './council';
import { applyCommand } from './commands';
import { lineIndex, population } from './core';
import { countyWeekDue } from './county-week';
import { countyExpiry } from './expiry';
import { civicMemo } from './finance';
import { payFund } from './fund';
import { growKingsport, stepMoveMoney } from './regional-day';
import { countyMoney, regionOf } from './region-state';
import { emptyBooks } from './core';
import type { CountyState } from './types';

function entrant(town: number, pop: number, score: number): Entrant {
  return { town, pop, scores: new Array(AWARD_POOL.length).fill(score) };
}

describe('County Fair awards', () => {
  it('gives a town at most 2 awards a week, and ties to the smaller town', () => {
    const e = [entrant(0, 9000, 10), entrant(1, 3000, 5), entrant(2, 1000, 5)];
    const won = pickAwards(e, [0, 1, 2, 3, 4, 5], 2);
    const count = (t: number) => won.filter((w) => w.town === t).length;
    expect(count(0)).toBe(2);
    // Towns 1 and 2 tie on every score: the smaller town (2) is preferred.
    expect(count(2)).toBe(2);
    expect(count(1)).toBe(2);
    expect(won[2].town).toBe(2);
  });

  it('guarantees a Mention to a mayor who has won nothing for 2 weeks', () => {
    // Five towns share six awards (at most 2 each): four good towns can take them all.
    const { c } = multiCounty(5);
    linkAll(c);
    const BAD = 4;
    for (let i = 0; i < 5; i++) {
      const t = c.towns[i];
      const good = i !== BAD;
      t.happy.fill(good ? 80 - i : 10);
      t.perceived.fill(good ? 70 - i : 5);
      t.rep = good ? 70 - i : 5;
      t.ps = good ? i : 90;
      civicMemo(t).mood = good ? 70 : 10;
    }
    // The bad town is also the biggest, so it loses every tie.
    for (let k = 0; k < c.towns[BAD].people.length; k++) c.towns[BAD].people[k] *= 3;
    for (const t of c.towns) t.books = emptyBooks(t.money.reserves, population(t));
    const mentions: number[] = [];
    let weeks = 0;
    for (let d = 0; d < 36; d++) {
      const before = c.awards.week;
      runDay(c);
      if (c.awards.week === before) continue;
      weeks++;
      const w = c.awards.week;
      for (let i = 0; i < 5; i++) expect(c.awards.history.filter((h) => h.week === w && h.town === i).length).toBeLessThanOrEqual(2);
      expect(c.awards.history.some((h) => h.week === w && h.town === BAD)).toBe(false);
      if (c.towns[BAD].inbox.some((x) => x.kind === 'mention' && x.day === c.dayIndex - 1)) mentions.push(w);
    }
    expect(weeks).toBeGreaterThanOrEqual(4);
    // Recognised at least once a fortnight: weeks 2, 4, …
    expect(mentions.length).toBe(Math.floor(weeks / 2));
    for (let k = 1; k < mentions.length; k++) expect(mentions[k] - mentions[k - 1]).toBe(2);
  });
});

describe('the Council', () => {
  it('breaks a tie with the youngest mayor’s vote and ignores archived towns', () => {
    const { c } = multiCounty(3);
    c.settings.youngestOrder = ['s2', 's0', 's1'];
    c.council = { question: 'commuterRule', options: ['workTownKeeps', 'fairShare', 'halfAndHalf'], votes: [0, null, 2], closesDay: 7, results: [] };
    expect(tally(c)).toBe(2);
    c.towns[2].archived = true;
    expect(tally(c)).toBe(0);
    c.council.votes = [null, null, null];
    expect(tally(c)).toBeNull();
  });

  it('takes one vote per town on the open question only, and the result takes effect when it closes', () => {
    const { c } = multiCounty(3);
    const now = () => c.lastRegionalDayAt;
    c.council = { question: 'commuterRule', options: ['workTownKeeps', 'fairShare', 'halfAndHalf'], votes: [null, null, null], closesDay: c.dayIndex, results: [] };
    expect(() => applyCommand(c, 's0', { type: 'vote', moveId: 'v0', question: 'cleanAir', choice: 0 }, now())).toThrow(/closed/);
    applyCommand(c, 's0', { type: 'vote', moveId: 'v1', question: 'commuterRule', choice: 2 }, now());
    applyCommand(c, 's0', { type: 'vote', moveId: 'v2', question: 'commuterRule', choice: 0 }, now());
    applyCommand(c, 's1', { type: 'vote', moveId: 'v3', question: 'commuterRule', choice: 0 }, now());
    expect(c.council.votes).toEqual([0, 0, null]);
    // Run to the County Week: the rule changes to "work town keeps it".
    while (c.council.results.length === 0) runDay(c);
    expect(c.council.results[0]).toMatchObject({ question: 'commuterRule', choice: 0 });
    expect(regionOf(c).commuterRule).toBe(0);
  });
});

describe('the Development Fund', () => {
  function sized(pops: number[]): CountyState {
    const { c } = multiCounty(pops.length);
    pops.forEach((p, i) => {
      const t = c.towns[i];
      t.people.fill(0);
      t.people[0] = p;
      t.books = emptyBooks(t.money.reserves, p);
    });
    return c;
  }

  it('the largest town pays 1.5% of its day’s revenue in only above 2× the median', () => {
    for (const [big, pays] of [[2100, true], [1900, false]] as const) {
      const c = sized([big, 1000, 1000]);
      c.towns[0].books.dayLines[lineIndex('homesTax')] = 100_000;
      const m0 = countyMoney(c);
      stepMoveMoney(c, nextContext(c));
      expect(c.fund).toBe(pays ? 1500 : 0);
      expect(countyMoney(c)).toBe(m0);
      expect(c.towns[0].trophies.includes('generousBenefactor')).toBe(pays);
    }
  });

  it('pays out to towns below the median in proportion to how far below, to the penny', () => {
    const c = sized([5000, 3000, 1000, 2000, 4000]);
    c.fund = 1001;
    const m0 = countyMoney(c);
    const grants = payFund(c);
    expect(grants.reduce((a, b) => a + b, 0)).toBe(1001);
    expect(c.fund).toBe(0);
    expect(grants[0]).toBe(0);
    expect(grants[1]).toBe(0);
    expect(grants[4]).toBe(0);
    // Gaps 2000 and 1000: 2:1.
    expect(Math.abs(grants[2] - 2 * grants[3])).toBeLessThanOrEqual(2);
    expect(countyMoney(c)).toBe(m0);
  });
});

describe('seasons (A22)', () => {
  it('runs a County Week on Sundays only, and once after a swallowed Sunday', () => {
    const { c } = multiCounty(2);
    const r = nextContext(c);
    const day = londonDay(r.at);
    const sunday = day + ((7 - weekday(day)) % 7);
    // A Sunday's Regional Day.
    c.lastRegionalDayAt = londonInstant(sunday - 1, 18);
    expect(countyWeekDue(c, { ...r, at: londonInstant(sunday, 18) })).toBe(true);
    // A Monday right after a normal Sunday: no.
    c.lastRegionalDayAt = londonInstant(sunday, 18);
    regionOf(c).lastWeekDay = sunday;
    expect(countyWeekDue(c, { ...r, at: londonInstant(sunday + 1, 18) })).toBe(false);
    // A pause swallowed Sunday (last day ran Friday): the first day after waking runs it, once.
    regionOf(c).lastWeekDay = sunday - 7;
    c.lastRegionalDayAt = londonInstant(sunday - 2, 18);
    expect(countyWeekDue(c, { ...r, at: londonInstant(sunday + 2, 18) })).toBe(true);
    regionOf(c).lastWeekDay = sunday;
    c.lastRegionalDayAt = londonInstant(sunday + 2, 18);
    expect(countyWeekDue(c, { ...r, at: londonInstant(sunday + 3, 18) })).toBe(false);
  });

  it('ends a season after 6 County Weeks: a trophy for every mayor, holidays renewed, a new board each week', () => {
    const { c } = multiCounty(2);
    c.towns[0].holiday.usedDays = 9;
    const season = c.season.n;
    let weeks = 0;
    while (c.season.n === season && weeks < 8) {
      const before = c.awards.week;
      runDay(c);
      if (c.awards.week > before) {
        weeks++;
        expect(c.goals.goals).toHaveLength(8);
        for (const g of c.goals.goals) expect(g.target).toBeGreaterThanOrEqual(1);
        expect(c.gazette.length).toBeGreaterThan(0);
      }
    }
    expect(weeks).toBe(6);
    expect(c.season.n).toBe(season + 1);
    expect(c.towns[0].holiday.usedDays).toBe(0);
    for (const t of c.towns) expect(t.trophies.some((x) => x.startsWith(`season${season}.`))).toBe(true);
    // The first question of a season asks for the Great Work.
    expect(c.council.question).toBe('greatWork');
  });
});

describe('the Gazette (data)', () => {
  it('is deterministic, carries only numbers and strings, and gives every town a story', () => {
    const run = () => {
      const { c } = multiCounty(3);
      linkAll(c);
      while (c.awards.week === 0) runDay(c);
      return c;
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(b.gazette)).toBe(JSON.stringify(a.gazette));
    const issue = a.gazette[a.gazette.length - 1];
    expect(issue.items[0].key).toBe('gazette.masthead');
    for (const it of issue.items) for (const v of Object.values(it.data)) expect(['number', 'string']).toContain(typeof v);
    const towns = new Set<number>();
    for (const it of issue.items) if ((it.key === 'gazette.lead' || it.key === 'gazette.headline') && typeof it.data.town === 'number') towns.add(it.data.town);
    expect(towns.size).toBe(3);
  });
});

describe('the year end', () => {
  it('banks one Initiative a day, up to 7', () => {
    const { c } = multiCounty(1);
    c.towns[0].initiatives = 5;
    runDay(c);
    expect(c.towns[0].initiatives).toBe(6);
    for (let d = 0; d < 3; d++) runDay(c);
    expect(c.towns[0].initiatives).toBe(7);
  });

  it('grows Kingsport toward its cap, never past it', () => {
    const { c } = multiCounty(2);
    const cap = 40_000 + 15_000 * 2;
    const start = c.kingsport.pop;
    growKingsport(c, regionOf(c).kingsportMonth + 12);
    expect(c.kingsport.pop).toBeGreaterThan(start);
    growKingsport(c, regionOf(c).kingsportMonth + 600);
    expect(c.kingsport.pop).toBeLessThanOrEqual(cap);
  });
});

describe('a forgotten county (A40)', () => {
  it('warns from day 60, stops heartbeats at day 90, and expects deletion about 120 days after the last visit', () => {
    const { c } = multiCounty(1);
    const t0 = c.lastHelloAt;
    expect(countyExpiry(c, t0 + 10 * MS_DAY).stage).toBe('awake');
    expect(countyExpiry(c, t0 + 61 * MS_DAY).stage).toBe('warn');
    const e = countyExpiry(c, t0 + 91 * MS_DAY);
    expect(e.stage).toBe('stopped');
    expect(e.deleteAt).toBe(t0 + 120 * MS_DAY);
  });
});
