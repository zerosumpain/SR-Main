import { describe, expect, it } from 'vitest';
import {
  isReseller,
  officialOnly,
  overpassNearbyQuery,
  parseLooseJson,
  placeFromNominatim,
  readDraftWishes,
  readClosedDates,
  readFacts,
  readWeeklyHours,
  searchQuery,
  suggestionsFromOverpass,
} from './research';
import { windowsOn } from './solver/hours';

describe('resellers', () => {
  it('never offers a reseller as the booking link', () => {
    expect(isReseller('https://www.getyourguide.com/rome-l33/')).toBe(true);
    expect(isReseller('https://www.tiqets.com/en/colosseum')).toBe(true);
    expect(isReseller('https://ticketing.colosseo.it/')).toBe(false);
    expect(officialOnly('https://www.viator.com/x')).toBeNull();
    expect(officialOnly('ftp://museum.example')).toBeNull();
    expect(officialOnly('https://www.museivaticani.va/')).toBe('https://www.museivaticani.va/');
  });
});

describe('readFacts', () => {
  const results = [
    { title: 'Parco archeologico del Colosseo', url: 'https://colosseo.it/en/tickets/' },
    { title: 'Colosseum tickets — GetYourGuide', url: 'https://www.getyourguide.com/colosseum' },
  ];
  it('keeps grounded official links, prefers OSM hours and website, and lists unknowns', () => {
    const facts = readFacts({
      raw: {
        bookingRequired: true,
        bookAheadDays: 21,
        bookingUrl: 'https://www.getyourguide.com/colosseum',
        officialUrl: 'https://made-up.example/',
        typicalVisitMin: 180,
        summary: 'Timed entry.',
        sourceUrls: ['https://colosseo.it/en/tickets/', 'https://invented.example/'],
      },
      results,
      osm: { openingHoursText: 'Mo-Su 08:30-17:00', website: 'https://colosseo.it/', wikidata: 'Q10285' },
      previous: null,
      depth: 'brief',
      checkedAt: '2026-10-13T10:00:00Z',
    });
    expect(facts).toMatchObject({
      bookingRequired: true,
      bookAheadDays: 21,
      bookingUrl: null, // a reseller, refused
      officialUrl: 'https://colosseo.it/', // OSM wins; the invented one is not grounded
      openingHoursText: 'Mo-Su 08:30-17:00',
      typicalVisitSec: 10800,
      depth: 'brief',
      checkedAt: '2026-10-13T10:00:00Z',
    });
    expect(facts.sources.map((s) => s.url)).toEqual(['https://colosseo.it/en/tickets/', 'https://www.openstreetmap.org/copyright']);
    expect(facts.unknown).toEqual(['official booking link', 'price']);
  });

  it('closures the reader finds land in closedDates (inside the trip only), not just the summary', () => {
    const prev = { ...readFacts({ raw: null, results: [], osm: { openingHoursText: null, website: null, wikidata: null }, previous: null, depth: 'brief', checkedAt: 'a' }), closedDates: ['2026-10-29'] };
    const facts = readFacts({
      raw: { closedDays: 'Mondays; 28 Oct (strike)', closedDates: ['2026-10-28', '2026-10-28', '2026-12-25', 'next Tuesday', '2026-02-30x'], summary: 'Big.' },
      results,
      osm: { openingHoursText: null, website: null, wikidata: null },
      previous: prev,
      depth: 'deep',
      checkedAt: 'b',
      trip: { startDate: '2026-10-27', endDate: '2026-10-30' },
    });
    expect(facts.closedDates).toEqual(['2026-10-28', '2026-10-29']); // an earlier closure is kept
    expect(facts.summary).toBe('Big. Closed: Mondays; 28 Oct (strike).');
    // Without the trip's dates nothing is trusted as a closure.
    expect(readFacts({ raw: { closedDates: ['2026-10-28'] }, results, osm: { openingHoursText: null, website: null, wikidata: null }, previous: null, depth: 'brief', checkedAt: 'c' }).closedDates).toEqual([]);
  });

  it("the reader's weekly hours fill facts.hours only when OSM has none; a day it does not state stays unknown", () => {
    const osmNone = { openingHoursText: null, website: null, wikidata: null };
    const facts = readFacts({ raw: { weeklyHours: { Mo: 'closed', Tu: '09:00-19:00', We: '09:00-13:00, 15:00-19:00', Th: null, Fr: 'ask at the desk' } }, results, osm: osmNone, previous: null, depth: 'brief', checkedAt: 'x' });
    expect(facts.hours).toEqual({ 1: [], 2: [{ openMin: 540, closeMin: 1140 }], 3: [{ openMin: 540, closeMin: 780 }, { openMin: 900, closeMin: 1140 }] });
    expect(facts.unknown).not.toContain('opening hours');
    expect(windowsOn(facts, '2026-10-26')).toEqual([]); // a Monday: closed
    expect(windowsOn(facts, '2026-10-29')).toBeNull(); // a Thursday: unknown, never "closed by omission"
    // OSM's own text wins: the reader's hours are not used over it.
    const osm = readFacts({ raw: { weeklyHours: { Mo: 'closed' } }, results, osm: { openingHoursText: 'Mo-Su 08:30-17:00', website: null, wikidata: null }, previous: null, depth: 'brief', checkedAt: 'x' });
    expect(osm.hours).toBeNull();
    expect(windowsOn(osm, '2026-10-26')).toEqual([{ openMin: 510, closeMin: 1020 }]);
    // Nothing readable → unknown.
    expect(readWeeklyHours({ Mo: 'sometimes' })).toBeNull();
    expect(readWeeklyHours(null)).toBeNull();
    expect(readClosedDates(['2026-10-28'], null)).toEqual([]);
  });

  it('marks everything unknown when the search failed and OSM said nothing', () => {
    const facts = readFacts({ raw: null, results: [], osm: { openingHoursText: null, website: null, wikidata: null }, previous: null, depth: 'deep', checkedAt: 'x' });
    expect(facts.unknown).toHaveLength(7);
    expect(facts.depth).toBe('deep');
  });
});

describe('OpenStreetMap', () => {
  it('reads a Nominatim row with extratags', () => {
    const place = placeFromNominatim({
      lat: '41.8986',
      lon: '12.4769',
      name: 'Pantheon',
      display_name: 'Pantheon, Piazza della Rotonda, Rome, Italy',
      osm_type: 'way',
      osm_id: 4295162,
      extratags: { opening_hours: 'Mo-Su 09:00-19:00', website: 'https://www.pantheonroma.com/', wikidata: 'Q99309' },
    });
    expect(place).toEqual({
      name: 'Pantheon',
      location: { lat: 41.8986, lng: 12.4769 },
      osmId: 'way/4295162',
      address: 'Pantheon, Piazza della Rotonda, Rome, Italy',
      openingHoursText: 'Mo-Su 09:00-19:00',
      website: 'https://www.pantheonroma.com/',
      wikidata: 'Q99309',
    });
    expect(placeFromNominatim({ lat: 'x' })).toBeNull();
  });

  it('suggests nearby extras that are not already wishes, nearest first, at most five', () => {
    const elements = [
      { type: 'node', id: 1, lat: 41.9, lon: 12.48, tags: { name: 'Pantheon', tourism: 'attraction', wikidata: 'Q1' } },
      { type: 'node', id: 2, lat: 41.901, lon: 12.481, tags: { name: 'Sant Ignazio', tourism: 'attraction', wikidata: 'Q2' } },
      { type: 'way', id: 3, center: { lat: 41.95, lon: 12.5 }, tags: { name: 'Far Museum', tourism: 'museum', wikidata: 'Q3', website: 'https://www.getyourguide.com/x' } },
      { type: 'node', id: 4, lat: 41.9005, lon: 12.4805, tags: { name: 'Near Column', historic: 'monument', wikidata: 'Q4' } },
    ];
    const out = suggestionsFromOverpass({ elements }, [{ title: 'Pantheon', place: null }], { lat: 41.9, lng: 12.48 }, 2);
    expect(out.map((s) => s.title)).toEqual(['Near Column', 'Sant Ignazio']);
    expect(out[0].place.osmId).toBe('node/4');
    expect(overpassNearbyQuery({ lat: 41.9, lng: 12.48 })).toContain('around:1200,41.900000,12.480000');
  });
});

describe('free text', () => {
  it('reads drafts leniently and dedupes them', () => {
    const raw = parseLooseJson('Here you go:\n```json\n{"wishes":[{"title":"Colosseum","priority":"must","durationMin":180,"partOfDay":"morning"},{"title":"colosseum"},{"title":"Trastevere dinner","partOfDay":"night"}]}\n```');
    expect(readDraftWishes(raw)).toEqual([
      { title: 'Colosseum', priority: 'must', durationSec: 10800, partOfDay: 'morning', note: null },
      { title: 'Trastevere dinner', priority: 'nice', durationSec: null, partOfDay: 'any', note: null },
    ]);
    expect(readDraftWishes(null)).toEqual([]);
  });

  it('asks a brief and a deeper question', () => {
    expect(searchQuery({ title: 'Borghese', place: null }, { destination: 'Rome' }, 'brief')).toContain('official site tickets');
    expect(searchQuery({ title: 'Borghese', place: null }, { destination: 'Rome' }, 'deep')).toContain('how far in advance');
  });
});

describe('placeQueries', () => {
  it('tries the name, without codes, the street after a business name, then the name alone', async () => {
    const { placeQueries } = await import('./research');
    expect(placeQueries('Rome Fiumicino Airport FCO', 'Rome')).toEqual(['Rome Fiumicino Airport FCO, Rome', 'Rome Fiumicino Airport']);
    expect(placeQueries("Hotel Campo de' Fiori, Via del Biscione 6, Rome", 'Rome')).toEqual([
      "Hotel Campo de' Fiori, Via del Biscione 6, Rome",
      "Via del Biscione 6, Rome",
      "Hotel Campo de' Fiori",
    ]);
    expect(placeQueries('Pantheon', 'New trip')).toEqual(['Pantheon']);
  });
});
