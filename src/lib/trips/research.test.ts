import { describe, expect, it } from 'vitest';
import {
  isReseller,
  officialOnly,
  overpassNearbyQuery,
  parseLooseJson,
  placeFromNominatim,
  readDraftWishes,
  readFacts,
  searchQuery,
  suggestionsFromOverpass,
} from './research';

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
