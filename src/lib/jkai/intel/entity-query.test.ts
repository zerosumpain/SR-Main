import { describe, it, expect } from 'vitest';
import {
  parseEntityQuery,
  entityQueryToSearch,
  pageInfo,
  escapeLike,
  activeFilterCount,
  toggleFacet,
  parseList,
  DEFAULT_ENTITY_QUERY,
  SORT_DEFAULT_DIR,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
  MAX_QUERY_LENGTH,
  MAX_FACET_VALUES,
  type EntityQuery,
} from './entity-query';

const parse = (search: string) => parseEntityQuery(new URLSearchParams(search));

function query(over: Partial<EntityQuery> = {}): EntityQuery {
  return { ...DEFAULT_ENTITY_QUERY, ...over };
}

describe('parseEntityQuery — defaults', () => {
  it('returns the default query for an empty URL', () => {
    expect(parse('')).toEqual(DEFAULT_ENTITY_QUERY);
  });

  it('trims and length-caps the search text', () => {
    expect(parse('q=%20%20ibca%20%20').q).toBe('ibca');
    const long = 'x'.repeat(MAX_QUERY_LENGTH + 50);
    expect(parse(`q=${long}`).q).toHaveLength(MAX_QUERY_LENGTH);
  });
});

describe('parseEntityQuery — facets', () => {
  it('accepts CSV and repeated params, de-duplicating', () => {
    expect(parse('types=a,b&types=b,c').typeIds).toEqual(['a', 'b', 'c']);
  });

  it('folds the legacy typeId param into the type facet', () => {
    expect(parse('typeId=person').typeIds).toEqual(['person']);
    expect(parse('types=org&typeId=person').typeIds).toEqual(['org', 'person']);
  });

  it('does not duplicate a legacy typeId already present in types', () => {
    expect(parse('types=org&typeId=org').typeIds).toEqual(['org']);
  });

  it('drops confidence values outside the known levels', () => {
    expect(parse('confidence=low,bogus,high').confidence).toEqual(['low', 'high']);
  });

  it('caps facet lists so a hostile URL cannot build an unbounded IN-list', () => {
    const many = Array.from({ length: MAX_FACET_VALUES + 25 }, (_, i) => `t${i}`).join(',');
    expect(parse(`types=${many}`).typeIds).toHaveLength(MAX_FACET_VALUES);
  });

  it('falls back to "all" for unknown tri-state values', () => {
    expect(parse('confirmed=maybe').confirmed).toBe('all');
    expect(parse('watched=sometimes').watched).toBe('all');
    expect(parse('confirmed=unconfirmed&watched=watched')).toMatchObject({
      confirmed: 'unconfirmed',
      watched: 'watched',
    });
  });

  it('treats a blank lens as absent but keeps the "none" sentinel', () => {
    expect(parse('lens=%20').lens).toBeNull();
    expect(parse('lens=none').lens).toBe('none');
    expect(parse('lens=professional').lens).toBe('professional');
  });
});

describe('parseEntityQuery — sorting', () => {
  it('rejects an unknown sort key', () => {
    expect(parse('sort=hax').sort).toBe(DEFAULT_ENTITY_QUERY.sort);
  });

  it('applies the sort-specific default direction', () => {
    expect(parse('sort=name').dir).toBe('asc');
    expect(parse('sort=connections').dir).toBe('desc');
    expect(parse('sort=corroboration').dir).toBe('desc');
    expect(parse('sort=importance').dir).toBe('desc');
  });

  it('lets an explicit direction override the default', () => {
    expect(parse('sort=name&dir=desc').dir).toBe('desc');
    expect(parse('sort=connections&dir=asc').dir).toBe('asc');
  });

  it('ignores a nonsense direction', () => {
    expect(parse('sort=name&dir=sideways').dir).toBe('asc');
  });

  it('has a default direction for every sort key', () => {
    for (const sort of Object.keys(SORT_DEFAULT_DIR)) {
      expect(parse(`sort=${sort}`).sort).toBe(sort);
    }
  });
});

describe('parseEntityQuery — paging', () => {
  it('clamps page size into range', () => {
    expect(parse('pageSize=99999').pageSize).toBe(MAX_PAGE_SIZE);
    expect(parse('pageSize=1').pageSize).toBe(MIN_PAGE_SIZE);
    expect(parse('pageSize=abc').pageSize).toBe(DEFAULT_ENTITY_QUERY.pageSize);
  });

  it('never returns a page below 1', () => {
    expect(parse('page=0').page).toBe(1);
    expect(parse('page=-4').page).toBe(1);
    expect(parse('page=NaN').page).toBe(1);
  });

  it('maps the legacy limit param onto page size', () => {
    expect(parse('limit=25').pageSize).toBe(25);
    expect(parse('limit=100000').pageSize).toBe(MAX_PAGE_SIZE);
  });

  it('derives a page from the legacy offset param', () => {
    expect(parse('limit=25&offset=50').page).toBe(3);
    expect(parse('limit=25&offset=0').page).toBe(1);
    // A partial offset lands on the page that contains it.
    expect(parse('limit=25&offset=30').page).toBe(2);
  });

  it('prefers an explicit page over a stale offset', () => {
    expect(parse('limit=25&offset=200&page=2').page).toBe(2);
  });
});

describe('entityQueryToSearch', () => {
  it('emits nothing for the default query', () => {
    expect(entityQueryToSearch(DEFAULT_ENTITY_QUERY)).toBe('');
  });

  it('omits a direction that matches the sort default', () => {
    expect(entityQueryToSearch(query({ sort: 'name', dir: 'asc' }))).toBe('sort=name');
    expect(entityQueryToSearch(query({ sort: 'name', dir: 'desc' }))).toBe('sort=name&dir=desc');
  });

  it('omits page 1', () => {
    expect(entityQueryToSearch(query({ page: 1 }))).toBe('');
    expect(entityQueryToSearch(query({ page: 3 }))).toBe('page=3');
  });

  it('applies overrides without mutating the source query', () => {
    const source = query({ page: 4 });
    expect(entityQueryToSearch(source, { page: 1 })).toBe('');
    expect(source.page).toBe(4);
  });

  it('round-trips through parseEntityQuery', () => {
    const original = query({
      q: 'data strategy',
      typeIds: ['t1', 't2'],
      confidence: ['low'],
      confirmed: 'unconfirmed',
      watched: 'watched',
      lens: 'professional',
      sort: 'connections',
      dir: 'asc',
      page: 5,
      pageSize: 25,
    });
    expect(parse(entityQueryToSearch(original))).toEqual(original);
  });
});

describe('pageInfo', () => {
  it('describes a full page in the middle of a set', () => {
    expect(pageInfo(194, { page: 2, pageSize: 50 })).toMatchObject({
      page: 2,
      offset: 50,
      totalPages: 4,
      from: 51,
      to: 100,
      hasPrev: true,
      hasNext: true,
    });
  });

  it('describes the short final page', () => {
    expect(pageInfo(194, { page: 4, pageSize: 50 })).toMatchObject({
      offset: 150,
      from: 151,
      to: 194,
      hasNext: false,
    });
  });

  it('clamps a page past the end onto the last page', () => {
    // The bulk-delete case: the URL still says page 9, but only 30 rows remain.
    expect(pageInfo(30, { page: 9, pageSize: 25 })).toMatchObject({
      page: 2,
      offset: 25,
      totalPages: 2,
      from: 26,
      to: 30,
      hasNext: false,
    });
  });

  it('reports an empty set without a phantom row range', () => {
    expect(pageInfo(0, { page: 3, pageSize: 50 })).toMatchObject({
      page: 1,
      offset: 0,
      totalPages: 1,
      from: 0,
      to: 0,
      hasPrev: false,
      hasNext: false,
    });
  });

  it('coerces junk totals and page sizes rather than producing NaN offsets', () => {
    expect(pageInfo(Number.NaN, { page: 1, pageSize: 50 })).toMatchObject({ total: 0, offset: 0 });
    expect(pageInfo(-10, { page: 1, pageSize: 50 })).toMatchObject({ total: 0 });
    expect(pageInfo(100, { page: 1, pageSize: Number.NaN })).toMatchObject({
      pageSize: DEFAULT_ENTITY_QUERY.pageSize,
    });
    expect(pageInfo(100, { page: 1, pageSize: 10_000 })).toMatchObject({ pageSize: MAX_PAGE_SIZE });
  });

  it('keeps a single page when the total exactly fills it', () => {
    expect(pageInfo(50, { page: 1, pageSize: 50 })).toMatchObject({
      totalPages: 1,
      to: 50,
      hasNext: false,
    });
  });
});

describe('escapeLike', () => {
  it('neutralises ILIKE wildcards', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
  });

  it('escapes the escape character first so it cannot be smuggled through', () => {
    expect(escapeLike('a\\%b')).toBe('a\\\\\\%b');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLike('IBCA data strategy')).toBe('IBCA data strategy');
  });
});

describe('activeFilterCount', () => {
  it('is zero for the default query', () => {
    expect(activeFilterCount(DEFAULT_ENTITY_QUERY)).toBe(0);
  });

  it('counts each narrowing facet once, ignoring sort and paging', () => {
    expect(activeFilterCount(query({ sort: 'name', page: 7, pageSize: 25 }))).toBe(0);
    expect(
      activeFilterCount(
        query({ q: 'x', typeIds: ['a', 'b'], confirmed: 'unconfirmed', watched: 'watched', lens: 'none' }),
      ),
    ).toBe(5);
  });
});

describe('toggleFacet', () => {
  it('adds a missing value and removes a present one', () => {
    expect(toggleFacet(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleFacet(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('does not mutate the input', () => {
    const source = ['a'];
    toggleFacet(source, 'b');
    expect(source).toEqual(['a']);
  });
});

describe('parseList', () => {
  it('drops empty segments left by trailing commas', () => {
    expect(parseList(new URLSearchParams('types=a,,b,'), 'types')).toEqual(['a', 'b']);
  });

  it('returns an empty list for a missing key', () => {
    expect(parseList(new URLSearchParams(''), 'types')).toEqual([]);
  });
});
