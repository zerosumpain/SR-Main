import { describe, expect, it } from 'vitest';
import type { PackPlace } from './decisions';
import {
  candidatesFromElements,
  closedOnDates,
  closureItems,
  commonsBatchUrl,
  filterPlaces,
  foodQuery,
  forecastReaches,
  imagesFromCommonsBatch,
  kindOfTags,
  lessVisitedOf,
  packCounts,
  packDue,
  packHighlights,
  packNeighbourhoods,
  packPlaceOf,
  parsePackAsk,
  parsePackReject,
  placesQuery,
  rainLine,
  readSparql,
  readSynthesis,
  selectFood,
  selectSights,
  sightsQuery,
  sparqlFor,
  synthesisPrompt,
  themeQuery,
  weatherItems,
  type PackCandidate,
  mergeSamePlaces,
} from './pack';
import { emptyFacts } from './research';

const FLAT = { lat: 41.8992, lng: 12.4731 };
const el = (id: number, tags: Record<string, string>, lat = 41.9, lng = 12.47) => ({ type: 'node', id, lat, lon: lng, tags });

function cand(over: Partial<PackCandidate> & { name: string }): PackCandidate {
  return { osmId: `node/${over.name.length}${Math.round(Math.random() * 1e6)}`, location: FLAT, address: null, kind: 'sight', tags: [], openingHours: null, website: null, wikidata: 'Q1', distanceM: 500, sitelinks: 10, imageFile: null, ...over };
}

describe('research pack: OpenStreetMap', () => {
  it('asks Overpass round each stay, sights and parks/churches apart, food near where they sleep', () => {
    const q = sightsQuery([FLAT, { lat: 41.89, lng: 12.49 }]);
    expect(q).toContain('nwr["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|aquarium|theme_park)$"]["name"]["wikidata"](around:2000,41.899200,12.473100)');
    expect(q).toContain('(around:2000,41.890000,12.490000)');
    expect(q).not.toContain('place_of_worship');
    expect(placesQuery([FLAT])).toContain('["amenity"~"^(place_of_worship|marketplace)$"]["name"]["wikidata"]');
    expect(foodQuery([FLAT])).toContain('nwr["amenity"~"^(restaurant|cafe|ice_cream)$"]["name"](around:650,41.899200,12.473100)');
    expect(themeQuery('things for the kids', [FLAT])).toContain('playground');
    expect(themeQuery('rainy day', [FLAT])).toContain('museum|gallery');
  });

  it('maps tags to kinds, and keeps food apart from sights', () => {
    expect(kindOfTags({ amenity: 'ice_cream' })).toBe('gelato');
    expect(kindOfTags({ amenity: 'restaurant', cuisine: 'gelato;italian' })).toBe('gelato');
    expect(kindOfTags({ amenity: 'cafe' })).toBe('cafe');
    expect(kindOfTags({ tourism: 'gallery' })).toBe('museum');
    expect(kindOfTags({ amenity: 'place_of_worship' })).toBe('church');
    expect(kindOfTags({ historic: 'ruins' })).toBe('sight');
    expect(kindOfTags({ leisure: 'garden' })).toBe('park');
    expect(kindOfTags({ amenity: 'bench' })).toBeNull();
    const answer = {
      elements: [
        el(1, { name: 'Pantheon', 'name:en': 'Pantheon', historic: 'church', wikidata: 'Q99309', opening_hours: 'Mo-Su 09:00-19:00' }, 41.8986, 12.4769),
        el(2, { name: 'Da Francesco', amenity: 'restaurant', cuisine: 'pizza;italian' }, 41.8995, 12.4712),
        el(3, { name: 'Musei Capitolini', 'name:en': 'Capitoline Museums', tourism: 'museum', wikidata: 'Q271015', website: 'https://www.getyourguide.com/x' }, 41.893, 12.4828),
        el(4, { name: 'Pantheon', tourism: 'attraction' }, 41.8987, 12.477),
        { type: 'way', id: 5, center: { lat: 41.9, lon: 12.48 }, tags: { name: 'Villa', leisure: 'park', fee: 'no' } },
      ],
    };
    const sights = candidatesFromElements(answer, [FLAT]);
    expect(sights.map((c) => c.name)).toEqual(['Pantheon', 'Villa', 'Capitoline Museums']);
    expect(sights[0]).toMatchObject({ osmId: 'node/1', kind: 'church', wikidata: 'Q99309', openingHours: 'Mo-Su 09:00-19:00', tags: ['rainy-day'] });
    // A reseller is never kept as a website.
    expect(sights[2].website).toBeNull();
    expect(sights[1].tags).toEqual(['free', 'outdoor']);
    expect(candidatesFromElements(answer, [FLAT], { food: true }).map((c) => [c.name, c.kind, c.tags])).toEqual([['Da Francesco', 'food', ['pizza', 'italian']]]);
  });

  it('keeps the famous first and at least a quarter less visited, but never plaques', () => {
    const famous = Array.from({ length: 30 }, (_, i) => cand({ name: `Famous ${i}`, sitelinks: 100 - i, kind: 'sight' }));
    const quiet = Array.from({ length: 12 }, (_, i) => cand({ name: `Quiet ${i}`, sitelinks: 5, kind: i % 2 ? 'museum' : 'park', distanceM: 100 + i }));
    const plaque = cand({ name: 'A plaque', sitelinks: 1, kind: 'sight', distanceM: 1 });
    const kept = selectSights([...famous, ...quiet, plaque], 20);
    expect(kept).toHaveLength(20);
    expect(kept.filter((c) => lessVisitedOf(c)).length).toBeGreaterThanOrEqual(5);
    expect(kept[0].name).toBe('Famous 0');
    expect(kept.some((c) => c.name === 'A plaque')).toBe(false);
    // Quiet ones alternate kinds (museum, park…).
    const quietKinds = kept.filter((c) => lessVisitedOf(c)).map((c) => c.kind);
    expect(new Set(quietKinds.slice(0, 2)).size).toBe(2);
    // Places already in the plan are not offered again.
    expect(selectSights(famous, 5, new Set(['famous 0'])).map((c) => c.name)).not.toContain('Famous 0');
  });

  it('food: some of each kind, the best described first', () => {
    const food = [
      ...Array.from({ length: 8 }, (_, i) => cand({ name: `Gelato ${i}`, kind: 'gelato', wikidata: null, sitelinks: null })),
      ...Array.from({ length: 20 }, (_, i) => cand({ name: `Trattoria ${i}`, kind: 'food', wikidata: null, sitelinks: null, openingHours: i < 3 ? 'Mo-Su 12:00-23:00' : null })),
    ];
    const kept = selectFood(food, 12);
    expect(kept.filter((c) => c.kind === 'gelato')).toHaveLength(4);
    expect(kept.filter((c) => c.kind === 'food')[0].openingHours).not.toBeNull();
    expect(lessVisitedOf(kept[0])).toBe(false);
  });
});

describe('research pack: Wikidata and Commons', () => {
  it('one SPARQL query for the fame signal and the image', () => {
    expect(sparqlFor(['Q10285', 'Q10285', 'bad', 'Q99309'])).toContain('VALUES ?item { wd:Q10285 wd:Q99309 }');
    const read = readSparql({
      results: {
        bindings: [
          { item: { value: 'http://www.wikidata.org/entity/Q10285' }, links: { value: '148' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Colosseo%202020.jpg' } },
          { item: { value: 'http://www.wikidata.org/entity/Q1247474' }, links: { value: '2' } },
          { item: { value: 'http://www.wikidata.org/entity/Q5' }, links: { value: '9' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Plan.svg' } },
        ],
      },
    });
    expect(read.get('Q10285')).toEqual({ sitelinks: 148, imageFile: 'Colosseo 2020.jpg' });
    expect(read.get('Q1247474')).toEqual({ sitelinks: 2, imageFile: null });
    // A drawing is not a photograph.
    expect(read.get('Q5')?.imageFile).toBeNull();
  });

  it('a Commons batch matched back through its title normalisation', () => {
    expect(commonsBatchUrl(['A b.jpg', 'C.jpg'])).toContain('titles=File%3AA+b.jpg%7CFile%3AC.jpg');
    const images = imagesFromCommonsBatch(
      {
        query: {
          normalized: [{ from: 'File:Colosseo_2020.jpg', to: 'File:Colosseo 2020.jpg' }],
          pages: {
            '1': { title: 'File:Colosseo 2020.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x/800px-C.jpg', thumbwidth: 800, thumbheight: 533, descriptionurl: 'https://commons.wikimedia.org/wiki/File:Colosseo_2020.jpg', extmetadata: { Artist: { value: '<a>Jane</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] },
            '-1': { title: 'File:Missing.jpg' },
          },
        },
      },
      new Map([['Colosseo_2020.jpg', 'Q10285'], ['Missing.jpg', 'Q1']]),
    );
    expect(images.get('Q10285')).toMatchObject({ url: 'https://upload.wikimedia.org/x/800px-C.jpg', credit: 'Jane', license: 'CC BY-SA 4.0', wikidata: 'Q10285' });
    expect(images.has('Q1')).toBe(false);
  });
});

describe('research pack: the write-up', () => {
  const trip = { destination: 'Rome', startDate: '2026-10-26', endDate: '2026-10-30' };
  const results = [{ title: 'Colosseum tickets', url: 'https://colosseo.it/en/tickets', content: 'Book 14 days ahead; underground €24' }];

  it('the prompt lists the places by ref and says when there was no search', () => {
    const p = synthesisPrompt({ trip, places: [cand({ name: 'Colosseum', sitelinks: 148 })], results: [] });
    expect(p).toContain('"ref":"p0","name":"Colosseum"');
    expect(p).toContain('the web search is not available; leave cost and booking null');
  });

  it('reads places by ref, keeps only URLs it was shown, and drops what was not checked', () => {
    const raw = {
      places: [
        { ref: 'p0', why: 'The great amphitheatre.', kind: 'sight', tags: ['Roman', 'ancient', '!!'], durationMin: 150, indoor: false, kidFriendly: true, neighbourhood: 'Monti', costText: '€24', bookingRequired: true, bookAheadDays: 14, sourceUrls: ['https://colosseo.it/en/tickets', 'https://made-up.example/'] },
        { ref: 'p1', why: 'A quiet palace.', costText: '€10', bookingRequired: true, sourceUrls: [] },
        { ref: 'p9', why: 'not ours' },
      ],
      neighbourhoods: [{ name: 'Monti', line: 'Old lanes and wine bars' }, { name: 'x' }],
      calendar: [
        { date: '2026-10-28', kind: 'strike', text: 'Transport strike, 24 hours', sourceUrl: 'https://colosseo.it/en/tickets' },
        { date: '2026-12-25', kind: 'holiday', text: 'Christmas', sourceUrl: 'https://colosseo.it/en/tickets' },
        { date: null, kind: 'closure', text: 'Made up', sourceUrl: 'https://nowhere.example/' },
      ],
    };
    const read = readSynthesis(raw, 2, results, trip);
    expect(read.places[0]).toMatchObject({ kind: 'sight', tags: ['roman', 'ancient'], durationMin: 150, costText: '€24', bookingRequired: true, bookAheadDays: 14, sources: [{ url: 'https://colosseo.it/en/tickets', title: 'Colosseum tickets' }] });
    // No source for it: cost and booking are not taken on the model's word.
    expect(read.places[1]).toMatchObject({ why: 'A quiet palace.', costText: null, bookingRequired: null });
    expect(read.neighbourhoods).toEqual([{ name: 'Monti', line: 'Old lanes and wine bars' }]);
    expect(read.calendar).toEqual([{ date: '2026-10-28', kind: 'strike', text: 'Transport strike, 24 hours', ref: null, sources: [{ url: 'https://colosseo.it/en/tickets', title: 'Colosseum tickets' }] }]);
    // Without a search at all, nothing that needs checking survives.
    expect(readSynthesis(raw, 2, [], trip).places[0]).toMatchObject({ costText: null, bookingRequired: null, bookAheadDays: null, sources: [] });
  });

  it('a stored place lists what is unknown and cites OpenStreetMap and Wikidata', () => {
    const c = cand({ name: 'Palazzo Altemps', kind: 'museum', wikidata: 'Q2', sitelinks: 12, openingHours: 'Tu-Su 09:30-19:00', osmId: 'way/30970813' });
    const p = packPlaceOf(c, null, null, '2026-10-21T12:00:00.000Z');
    expect(p).toMatchObject({ name: 'Palazzo Altemps', kind: 'museum', durationMin: 90, indoor: true, lessVisited: true, bookingRequired: null, status: 'candidate', tags: ['rainy-day'] });
    expect(p.facts?.unknown).toEqual(['whether booking is needed', 'price']);
    expect(p.sources.map((s) => s.url)).toEqual(['https://www.wikidata.org/wiki/Q2', 'https://www.openstreetmap.org/way/30970813']);
  });
});

describe('research pack: dates, weather, the summary', () => {
  const dates = ['2026-10-26', '2026-10-27', '2026-10-28'];
  it('places closed on one of the days (but not "closed every day", which is more likely a bad tag)', () => {
    const facts = (t: string) => ({ ...emptyFacts('brief', null), openingHoursText: t });
    const closed = closedOnDates(
      [
        { id: 'a', name: 'Borghese Gallery', facts: facts('Tu-Su 09:00-19:00; Mo off') },
        { id: 'b', name: 'Pantheon', facts: facts('Mo-Su 09:00-19:00') },
        { id: 'c', name: 'Weird', facts: facts('off') },
        { id: 'd', name: 'Unknown', facts: null },
      ],
      dates,
    );
    expect(closed).toEqual([{ name: 'Borghese Gallery', id: 'a', dates: ['2026-10-26'] }]);
    expect(closureItems(closed)).toEqual([{ date: '2026-10-26', kind: 'closure', text: 'Borghese Gallery is closed on Mon 26 Oct', placeId: 'a', sources: [{ url: 'https://www.openstreetmap.org/copyright', title: 'OpenStreetMap contributors' }] }]);
  });

  it('the forecast: rain by part of the day, and the light', () => {
    const hours = (date: string, pop: number[]) => pop.map((_, h) => `${date}T${String(h).padStart(2, '0')}:00`);
    const wetAfternoon = Array.from({ length: 24 }, (_, h) => (h >= 13 && h <= 16 ? 70 : 10));
    const wetAll = Array.from({ length: 24 }, () => 80);
    const json = {
      daily: { time: ['2026-10-28', '2026-10-29'], sunrise: ['2026-10-28T07:37'], sunset: ['2026-10-28T18:09'] },
      hourly: { time: [...hours('2026-10-28', wetAfternoon), ...hours('2026-10-29', wetAll)], precipitation_probability: [...wetAfternoon, ...wetAll] },
    };
    const items = weatherItems(json);
    expect(items.map((i) => [i.date, i.kind, i.text])).toEqual([
      ['2026-10-28', 'weather', 'Rain likely in the afternoon'],
      ['2026-10-29', 'weather', 'Rain likely all day'],
      [null, 'sun', 'Light from about 07:37 to 18:09'],
    ]);
    expect(rainLine(items[0])).toBe('Rain likely Wed afternoon');
    expect(rainLine(items[1])).toBe('Rain likely all day Thu');
    expect(weatherItems({ error: true })).toEqual([]);
    expect([forecastReaches('2026-10-30', '2026-10-21'), forecastReaches('2026-12-30', '2026-10-21')]).toEqual([true, false]);
  });

  it('the highlights read as the progress card does', () => {
    const p = (over: Partial<PackPlace>) => ({ name: 'x', kind: 'sight' as const, status: 'candidate' as const, bookingRequired: null, bookAheadDays: null, lessVisited: false, indoor: null, tags: [] as string[], ...over });
    const places = [
      ...Array.from({ length: 38 }, (_, i) => p({ name: `Sight ${i}`, lessVisited: i < 9, indoor: i < 11 })),
      ...Array.from({ length: 14 }, (_, i) => p({ name: `Food ${i}`, kind: 'food' })),
      p({ name: 'Colosseum underground', bookingRequired: true, bookAheadDays: 14 }),
      p({ name: 'Borghese Gallery', bookingRequired: true, bookAheadDays: 7 }),
      p({ name: 'Last Supper', bookingRequired: true, status: 'rejected', bookAheadDays: 90 }),
    ];
    const calendar = [{ date: '2026-10-29', kind: 'weather' as const, text: 'Rain likely in the afternoon', placeId: null, sources: [] }];
    expect(packHighlights(places, calendar)).toEqual(['Found 40 places', "14 places to eat near where you'll be", '2 need booking — Colosseum underground about 14 days ahead', 'Rain likely Thu afternoon', '9 quieter places off the usual list']);
    expect(packCounts(places)).toEqual({ places: 54, food: 14, toBook: 2, lessVisited: 9, rainy: 11 });
  });

  it("neighbourhoods: the city guide's, then the write-up's, each with its places", () => {
    expect(
      packNeighbourhoods([{ name: 'Parione', line: 'Baroque squares', places: ['Piazza Navona'] }], [{ name: 'Monti', line: 'Old lanes' }, { name: 'Empty', line: 'Nothing here' }], [
        { name: 'Palazzo Altemps', neighbourhood: 'parione' },
        { name: 'Colosseum', neighbourhood: 'Monti' },
      ]),
    ).toEqual([
      { name: 'Parione', line: 'Baroque squares', places: ['Piazza Navona', 'Palazzo Altemps'] },
      { name: 'Monti', line: 'Old lanes', places: ['Colosseum'] },
    ]);
  });

  it('when to build and when to refresh', () => {
    const trip = { destination: 'Rome', startDate: '2026-10-26', endDate: '2026-10-30' };
    const none = { status: 'none' as const, builtAt: null, refreshedAt: null };
    expect(packDue(trip, none, '2026-10-21')).toBe('build');
    expect(packDue(trip, none, '2026-10-01')).toBeNull();
    expect(packDue({ ...trip, destination: 'New trip' }, none, '2026-10-21')).toBeNull();
    expect(packDue(trip, { status: 'ready', builtAt: '2026-10-02T10:00:00Z', refreshedAt: null }, '2026-10-21')).toBe('refresh');
    expect(packDue(trip, { status: 'ready', builtAt: '2026-10-02T10:00:00Z', refreshedAt: '2026-10-20T10:00:00Z' }, '2026-10-21')).toBeNull();
    expect(packDue(trip, { status: 'ready', builtAt: '2026-10-19T10:00:00Z', refreshedAt: null }, '2026-10-21')).toBeNull();
    expect(packDue(trip, { status: 'building', builtAt: null, refreshedAt: null }, '2026-10-21')).toBeNull();
    expect(packDue(trip, none, '2026-11-02')).toBeNull();
  });

  it('filters by kind (food includes cafés and gelato) and tag; reads the POST body', () => {
    const places = [
      { kind: 'museum', tags: ['rainy-day'] },
      { kind: 'gelato', tags: [] },
      { kind: 'food', tags: ['pizza'] },
    ] as unknown as PackPlace[];
    expect(filterPlaces(places, { kind: 'food' })).toHaveLength(2);
    expect(filterPlaces(places, { tag: 'rainy-day' })).toHaveLength(1);
    expect(filterPlaces(places, { kind: 'museum,gelato' })).toHaveLength(2);
    expect(parsePackAsk({ action: 'more', theme: 'for the kids' })).toEqual({ ok: true, action: 'more', theme: 'for the kids' });
    expect(parsePackAsk({})).toEqual({ ok: true, action: 'build', theme: null });
    expect(parsePackAsk({ action: 'nuke' }).ok).toBe(false);
    expect(parsePackAsk({ action: 'more', theme: '<script>' }).ok).toBe(false);
    const id = 'c0ffee00-0000-4000-8000-000000000401';
    expect(parsePackReject({ action: 'reject', placeId: id, reason: 'too-far' })).toEqual({ ok: true, placeId: id, reason: 'too-far' });
    expect(parsePackReject({ action: 'reject', placeId: id, reason: 'meh' })).toMatchObject({ ok: false });
    expect(parsePackReject({ action: 'reject', reason: 'too-far' })).toMatchObject({ ok: false });
    expect(parsePackReject({ action: 'build' })).toBeNull();
  });
});

describe('mergeSamePlaces', () => {
  const c = (name: string, lat: number, lng: number, extra: Partial<PackCandidate> = {}): PackCandidate => ({
    osmId: `node/${name}`, name, location: { lat, lng }, address: null, kind: 'sight', tags: [], openingHours: null, website: null,
    wikidata: null, distanceM: 500, sitelinks: null, imageFile: null, ...extra,
  });
  it('keeps one Colosseum when OpenStreetMap maps it twice, the better-known one', () => {
    const out = mergeSamePlaces([c('Colosseo', 41.8902, 12.4922, { sitelinks: 40 }), c('Colosseum', 41.8903, 12.4924, { sitelinks: 180, wikidata: 'Q10285' }), c('Arch of Constantine', 41.8898, 12.4906)]);
    expect(out.map((p) => p.name).sort()).toEqual(['Arch of Constantine', 'Colosseum']);
  });
  it('merges by a shared Wikidata entry wherever the points are, and keeps namesakes far apart', () => {
    const out = mergeSamePlaces([c('Pantheon', 41.8986, 12.4769, { wikidata: 'Q99309' }), c('Il Pantheon', 41.9, 12.48, { wikidata: 'Q99309' }), c('Santa Maria', 41.89, 12.47), c('Santa Maria', 41.91, 12.5)]);
    expect(out.map((p) => p.name).sort()).toEqual(['Pantheon', 'Santa Maria', 'Santa Maria']);
  });
});
