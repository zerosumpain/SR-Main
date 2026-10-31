import { describe, expect, it } from 'vitest';
import { fitDates, formatWindow, readSpans, readTravelDates } from './dates';
import { evaluate } from './match';
import { validateCompiled } from './compile';
import type { WishCriteria } from './types';

const AS_OF = new Date('2026-10-31T12:00:00Z');
const spans = (t: string) => readSpans(t, AS_OF).map((s) => `${s.from}..${s.to}${s.precise ? '' : '~'}`);

// Every string here is a real hotukdeals or HolidayPirates title, 2026-10-31.
describe('reading dates the way deals write them', () => {
  it('a day range in one month, with or without a year or weekdays', () => {
    expect(spans('7 Nts 2 Adults | Half-Board | 12-17 Jan | Cyprus £281.45pp')).toEqual(['2027-01-12..2027-01-17']);
    expect(spans('6-11 December, 5 nights all-inclusive at 5* Be Live Collection Marrakech')).toEqual(['2026-12-06..2026-12-11']);
    expect(spans('5 Nights - Northern Europe Cruise, Full Board I P&O I 8th - 13th Feb 2027 - W/Code')).toEqual(['2027-02-08..2027-02-13']);
    expect(spans('4-Nts/5-Whole Days 2-Adults 4* Hotel Malta | Thu 10-Mon 14 Dec | Long Weekend Break')).toEqual(['2026-12-10..2026-12-14']);
  });

  it('a range across months, and month-first ranges', () => {
    expect(spans('14-Nts 2-Adults | All Inclusive | Mexico | 28 Oct-11 Nov | TUI')).toEqual(['2026-10-28..2026-11-11']);
    expect(spans('Tokyo (Japan): 10 nights in 4*-Sunshine City Prince Hotel | £989pp | Jan 18-29')).toEqual(['2027-01-18..2027-01-29']);
    expect(spans('Winter sun 28 Dec-4 Jan')).toEqual(['2026-12-28..2027-01-04']);
  });

  it('a single departure date', () => {
    expect(spans('7 Nights All Inclusive Lanzarote £334.64pp - TUI, Gatwick 30 Nov')).toEqual(['2026-11-30..2026-11-30']);
    expect(spans('7 Nights - Northern Europe Cruise, No Flights - 2 Adults, 20 Feb 2027 | From Southampton')).toEqual(['2027-02-20..2027-02-20']);
  });

  it('numeric UK dates', () => {
    expect(spans('Free Breakfast - For UK Stays 13/11/26 to 28/02/27 using code')).toEqual(['2026-11-13..2027-02-28']);
  });

  it('seasons and months', () => {
    expect(spans('Japan Adventure: 5 Flights from £724 Return. (Nov-Dec)')).toEqual(['2026-11-01..2026-12-31~']);
    expect(spans('10 Nts - 5* Graceland Khaolak Thailand // 7 Nights- £469(Apr-Oct 27)')).toEqual(['2027-04-01..2027-10-31~']);
    expect(spans('Prague - Hotel Pulse8 - £54 per night - Jan / Feb 2027 inc weekends')).toEqual(['2027-01-01..2027-02-28~']);
    expect(spans("you'll travel from London in early December")).toEqual(['2026-12-01..2026-12-10~']);
    expect(spans('This deal departs in January 2027')).toEqual(['2027-01-01..2027-01-31~']);
    expect(spans('May Half Term No Fly 7 Night Western Europe Cruise | 30 May 2027')).toContain('2027-05-30..2027-05-30');
  });

  it('a theme is not the holiday, and stated days outrank a season', () => {
    expect(spans('4-6 December, 2 Nights at 4 Star Unity Malmö, Sweden for Xmas Markets')).toEqual(['2026-12-04..2026-12-06']);
    expect(spans('Edinburgh Christmas markets break')).toEqual([]);
  });

  it('festivals by name', () => {
    expect(spans('Xmas break in the sun')).toEqual(['2026-12-20..2027-01-02~']);
    expect(spans('Easter family break')).toEqual(['2027-03-19..2027-04-05~']); // Easter Sunday 28 Mar 2027
  });

  it('does not read a verb, a night count or a price as a date', () => {
    expect(spans('You may want to book early')).toEqual([]);
    expect(spans('7 Nights All Inclusive £334.64pp, 2 Adults 2-Children')).toEqual([]);
    expect(spans('Book by 5 pm')).toEqual([]);
  });
});

describe('fitting a window', () => {
  const HALF_TERM = { from: '2027-02-13', to: '2027-02-21' };
  const fit = (title: string, description = '') => fitDates(readTravelDates(title, description, AS_OF), HALF_TERM);

  it('a stated trip inside the window fits; one outside does not', () => {
    expect(fit('7 nights Tenerife 14-21 Feb 2027').ok).toBe(true);
    expect(fit('7 nights Tenerife 8th - 13th Feb 2027')).toEqual({ ok: false, reason: '8 Feb–13 Feb, outside your dates' });
  });

  it('a stated season only has to overlap', () => {
    expect(fit('Prague - Jan / Feb 2027 inc weekends').ok).toBe(true);
    expect(fit('Winter sun in December').ok).toBe(false);
  });

  it('a deal priced for another month that offers other dates is a Check, not a no', () => {
    const f = fit('Half-board family getaway to lush 4🌟 Tenerife resort', "For this price, you'll travel from London in early December, but this holiday is completely customisable.");
    expect(f).toEqual({ ok: null, reason: 'priced for Dec 2026; other dates offered' });
  });

  it('silence is a Check', () => {
    expect(fit('4⭐ Cyprus half-board week').ok).toBeNull();
  });
});

describe('dates in a verdict', () => {
  const crit: WishCriteria = { maxPricePence: 200_000, nearMissPct: 10, price: { per: 'total', party: 4 }, constraints: [
    { field: 'attr', label: 'Nights', unit: 'nights', op: 'gte', value: 7, essential: true },
    { field: 'dates', from: '2027-02-13', to: '2027-02-21', label: 'February half term 2027' },
  ] };

  it('matches a family week in half term and turns away the week before', () => {
    expect(evaluate({ title: '7 nights Lanzarote 13-20 Feb £399pp', description: '', pricePence: 39_900 }, crit, AS_OF).verdict).toBe('match');
    expect(evaluate({ title: '7 nights Lanzarote 6-13 Feb £299pp', description: '', pricePence: 29_900 }, crit, AS_OF).verdict).toBe('no');
  });

  it('reads a yearless date from when the deal was posted', () => {
    const posted = { title: '7 nights Lanzarote 13-20 Feb £399pp', description: '', pricePence: 39_900, postedAt: '2026-03-01T00:00:00Z' };
    // Posted in March 2026, "13-20 Feb" is February 2027 … and so still fits.
    expect(evaluate(posted, crit, AS_OF).verdict).toBe('match');
  });
});

describe('compile: travel dates', () => {
  it('takes a school holiday from the table, and stops the hunt when the trip starts', () => {
    const c = validateCompiled({ kind: 'hunt', travelDates: { schoolHoliday: 'February half term 2027' } }, 'a week away at half term');
    expect(c.criteria.constraints).toEqual([{ field: 'dates', from: '2027-02-13', to: '2027-02-21', label: 'February half term 2027' }]);
    expect(c.deadline).toBe('2027-02-13');
  });

  it('takes explicit dates, refuses nonsense, and names an unknown holiday', () => {
    expect(validateCompiled({ travelDates: { from: '2027-03-01', to: '2027-03-31', label: 'March' } }, 'x').criteria.constraints).toHaveLength(1);
    expect(validateCompiled({ travelDates: { from: '2027-03-31', to: '2027-03-01' } }, 'x').criteria.constraints).toHaveLength(0);
    expect(validateCompiled({ travelDates: { schoolHoliday: 'Whitsun 1999' } }, 'x').dropped).toContain('school holiday "Whitsun 1999" is not in the table');
  });

  it('shows a window with its year', () => {
    expect(formatWindow('2027-02-13', '2027-02-21')).toBe('13–21 Feb 2027');
    expect(formatWindow('2026-12-19', '2027-01-03')).toBe('19 Dec 2026–3 Jan 2027');
  });
});

describe('compile: vague must-mentions', () => {
  it('drops a must-mention made only of words that describe the wish, and keeps a real one', () => {
    const c = validateCompiled({ constraints: [
      { field: 'text', op: 'contains_any', value: ['sunny'] },
      { field: 'text', op: 'contains_any', value: ['all inclusive', 'all-inclusive'] },
    ] }, 'a sunny all-inclusive week');
    expect(c.criteria.constraints).toEqual([{ field: 'text', op: 'contains_any', value: ['all inclusive', 'all-inclusive'] }]);
    expect(c.dropped).toEqual(['"must mention sunny" — listings do not say that']);
  });
});

describe('live-run regressions (2026-10-31)', () => {
  it('reads "Nts", and never a year as nights', async () => {
    const { readUnit } = await import('./units');
    expect(readUnit('nights', '4-Nts/5-Whole Days 2-Adults 4* Hotel Malta')).toBe(4);
    expect(readUnit('nights', '7 Nts 2 Adults | Half-Board')).toBe(7);
    expect(readUnit('nights', 'Sunday Jan to Feb 2027 nights')).toBeNull();
  });

  it('"Various Dec Dates" is December, not any date', () => {
    const r = readTravelDates('7-Nts, 4* Resort, Djerba Island, Various Dec Dates', '', AS_OF);
    expect(r.flexible).toBe(false);
    expect(fitDates(r, { from: '2027-02-13', to: '2027-02-21' }).ok).toBe(false);
  });

  it('HolidayPirates "UNDER £1K" is a thousand', async () => {
    const { parseHolidayPiratesFeed } = await import('./sources/holidaypirates');
    const [c] = await parseHolidayPiratesFeed('<?xml version="1.0"?><rss><channel><item><title>5🌟 family Mauritius holiday for UNDER £1K 🇲🇺</title><link>https://www.holidaypirates.com/packages/m</link><description>x</description></item></channel></rss>');
    expect(c.pricePence).toBe(100_000);
  });
});
