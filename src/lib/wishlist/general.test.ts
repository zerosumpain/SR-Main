import { describe, expect, it } from 'vitest';
import { readUnit } from './units';
import { evaluate } from './match';
import { parseHolidayPiratesFeed } from './sources/holidaypirates';
import { validateCompiled } from './compile';
import type { WishCriteria } from './types';

describe('units', () => {
  it('reads sizes however a listing writes them', () => {
    expect(readUnit('inch', 'Samsung 65" QLED TV')).toBe(65);
    expect(readUnit('inch', 'LG 55 inch OLED')).toBe(55);
    expect(readUnit('inch', 'Sony 50in 4K TV')).toBe(50);
    expect(readUnit('litre', 'Ninja Foodi 9.5L Dual Zone Air Fryer')).toBe(9.5);
    expect(readUnit('gb', 'iPhone 16 Pro 1TB')).toBe(1000);
    expect(readUnit('pieces', 'LEGO Rivendell 6,167 pieces')).toBe(6167);
  });

  it('reads a holiday: nights, stars, people', () => {
    expect(readUnit('nights', '4⭐ 10-night Rio de Janeiro break')).toBe(10);
    expect(readUnit('nights', 'Half-board week in Tenerife')).toBe(7);
    expect(readUnit('stars', '5🌟 family Mauritius holiday')).toBe(5);
    expect(readUnit('stars', '4⭐️ DoubleTree resort')).toBe(4);
    expect(readUnit('stars', 'a 4-star spa hotel')).toBe(4);
    expect(readUnit('stars', 'Rated 10 stars')).toBeNull();
    expect(readUnit('people', 'Lodge sleeps 6')).toBe(6);
    expect(readUnit('people', 'for 7 nights')).toBeNull();
  });

  it('reads the title before the description', () => {
    expect(readUnit('inch', 'Hisense 55in TV', 'better than our 43in model')).toBe(55);
    expect(readUnit('inch', 'Hisense 4K TV', 'a 43in model')).toBe(43);
  });
});

describe('matching anything', () => {
  const tv: WishCriteria = { maxPricePence: 60_000, nearMissPct: 10, constraints: [
    { field: 'attr', label: 'Screen', unit: 'inch', op: 'gte', value: 55, essential: true },
    { field: 'attr', label: 'Refresh', unit: 'hz', op: 'gte', value: 100 },
  ] };

  it('matches on a measured attribute', () => {
    expect(evaluate({ title: 'Hisense 65" 4K 144Hz TV', description: '', pricePence: 59_900 }, tv).verdict).toBe('match');
    expect(evaluate({ title: 'Hisense 50" 4K 144Hz TV', description: '', pricePence: 39_900 }, tv).verdict).toBe('no');
  });

  it('one unstated detail is a Check; an unstated ESSENTIAL is a no', () => {
    expect(evaluate({ title: 'Hisense 65" 4K TV', description: '', pricePence: 49_900 }, tv).verdict).toBe('possible');
    expect(evaluate({ title: 'Hisense 4K 144Hz TV', description: '', pricePence: 49_900 }, tv).verdict).toBe('no');
  });

  it('holds a per-person price × party against a total budget, and says so', () => {
    const hol: WishCriteria = { maxPricePence: 150_000, nearMissPct: 10, constraints: [], price: { per: 'total', party: 4 } };
    const cheap = evaluate({ title: 'Tenerife week £299pp', description: '', pricePence: 29_900 }, hol);
    expect(cheap.verdict).toBe('match');
    expect(cheap.results[0].reason).toBe('£1,196 (£299pp × 4) ≤ £1,500');
    expect(evaluate({ title: 'Tenerife week', description: '', pricePence: 45_000, perPerson: true }, hol).verdict).toBe('no');
    // A total price is not multiplied.
    expect(evaluate({ title: 'Tenerife villa, £1,400 for the week', description: '', pricePence: 140_000 }, hol).verdict).toBe('match');
  });
});

// Trimmed from the real HolidayPirates feed, 2026-10-31.
const HP = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>HolidayPirates</title>
<item><title>Half-board family getaway to lush 4🌟 Tenerife resort 🙌💦 </title><link>https://www.holidaypirates.com/packages/fergus-puerto-de-la-cruz-tenerife-spain</link><pubDate>Sat, 31 Oct 2026 08:00:00 +0000</pubDate><description>Pirates, we've found you a half-board week at a 4-star spa hotel in Tenerife from £225 for some winter sun. You'll get flights, plus a 7-night stay. You can also upgrade to all-inclusive for an extra £80. </description></item>
<item><title>4⭐ 10-night Rio de Janeiro break with flights &amp; breakfast under £900 🇧🇷</title><link>https://www.holidaypirates.com/packages/rio</link><pubDate>Fri, 30 Oct 2026 08:00:00 +0000</pubDate><description>Ten nights in Rio.</description></item>
<item><title>Elsewhere</title><link>https://evil.example/x</link><description>from £1</description></item>
</channel></rss>`;

describe('HolidayPirates', () => {
  it('reads the headline price (not an upgrade), per person, from the title or description', async () => {
    const out = await parseHolidayPiratesFeed(HP);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ source: 'holidaypirates', pricePence: 22_500, perPerson: true, postedAt: '2026-10-31T08:00:00.000Z' });
    expect(out[1].pricePence).toBe(90_000);
    expect(readUnit('nights', out[0].title, out[0].description)).toBe(7);
    expect(readUnit('stars', out[1].title)).toBe(4);
  });

  it('refuses a DOCTYPE', async () => {
    await expect(parseHolidayPiratesFeed('<!DOCTYPE x><rss></rss>')).rejects.toThrow();
  });
});

describe('compile: any product', () => {
  it('keeps attrs and value factors with known units, normalises weights, and reads the price basis', () => {
    const c = validateCompiled(
      {
        kind: 'hunt',
        maxPricePounds: 2000,
        pricePer: 'total',
        partySize: 4,
        holidayPirates: true,
        constraints: [
          { field: 'attr', label: 'Nights', unit: 'nights', op: 'gte', value: 7, essential: true },
          { field: 'attr', label: 'Beach distance', unit: 'metres', op: 'lte', value: 200 },
        ],
        value: [
          { label: 'Nights', measure: 'nights', weight: 3, ref: 7, better: 'higher' },
          { label: 'Hotel', measure: 'stars', weight: 1, ref: 4 },
          { label: 'Vibes', measure: 'vibes', weight: 1, ref: 1 },
        ],
      },
      'a family week in the sun',
    );
    expect(c.criteria.constraints).toEqual([{ field: 'attr', label: 'Nights', unit: 'nights', op: 'gte', value: 7, essential: true }]);
    expect(c.criteria.value).toEqual([
      { label: 'Nights', measure: 'nights', weight: 0.75, ref: 7, better: 'higher' },
      { label: 'Hotel', measure: 'stars', weight: 0.25, ref: 4, better: 'higher' },
    ]);
    expect(c.criteria.price).toEqual({ per: 'total', party: 4 });
    expect(c.feeds).toContainEqual({ source: 'holidaypirates', value: 'deals' });
    expect(c.dropped).toEqual(['"Beach distance" — no reader for unit "metres"', 'value factor "Vibes" — no reader for "vibes"']);
  });
});

describe('units: what is NOT a reading', () => {
  it('ignores a deal lifetime and a ratio', () => {
    expect(readUnit('nights', 'Air fryer deal, this week only')).toBeNull();
    expect(readUnit('nights', 'Cleaner £20 per week')).toBeNull();
    expect(readUnit('inch', '7 in 10 owners recommend')).toBeNull();
  });
});

describe('prices written for people', () => {
  it('reads thousands written with a k', async () => {
    const { parsePounds } = await import('./specs');
    expect(parsePounds('for UNDER £1K')).toBe(100_000);
    expect(parsePounds('from £1.5k')).toBe(150_000);
    expect(parsePounds('£1,099.99')).toBe(109_999);
    expect(parsePounds('£12 kit')).toBe(1_200);
  });
});
