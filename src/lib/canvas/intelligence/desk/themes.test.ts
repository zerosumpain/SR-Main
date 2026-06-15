import { describe, it, expect } from 'vitest';
import {
  themeOf,
  themeLayout,
  themeHeaders,
  THEMES,
  THEME,
  THEME_ZONE_ORIGIN,
  type ThemeArtefact,
  type ThemeKey,
} from './themes';
import { GRID, BAND } from './layout';

function src(id: string, domain?: string): ThemeArtefact {
  return { id, kind: 'source', fields: domain !== undefined ? { domain } : {} };
}
function fact(id: string, counterfactual = false): ThemeArtefact {
  return { id, kind: 'fact', fields: { isCounterfactual: counterfactual } };
}
function entity(id: string, type: string): ThemeArtefact {
  return { id, kind: 'entity', fields: { type } };
}

describe('themeOf', () => {
  it('maps a plain source to "sites"', () => {
    expect(themeOf(src('s1', 'example.com'))).toBe('sites');
    expect(themeOf(src('s2'))).toBe('sites'); // no domain → still a site
  });

  it('maps video-platform sources to "videos"', () => {
    expect(themeOf(src('v1', 'youtube.com'))).toBe('videos');
    expect(themeOf(src('v2', 'www.youtube.com'))).toBe('videos');
    expect(themeOf(src('v3', 'youtu.be'))).toBe('videos');
    expect(themeOf(src('v4', 'vimeo.com'))).toBe('videos');
    expect(themeOf(src('v5', 'dailymotion.com'))).toBe('videos');
    expect(themeOf(src('v6', 'twitch.tv'))).toBe('videos');
    expect(themeOf(src('v7', 'TikTok.com'))).toBe('videos'); // case-insensitive
  });

  it('does not misclassify a non-video domain that merely resembles one', () => {
    expect(themeOf(src('s3', 'example.com'))).toBe('sites');
    expect(themeOf(src('s4', 'news.bbc.co.uk'))).toBe('sites');
  });

  it('maps facts to "facts" and counterfactual facts to "challenges"', () => {
    expect(themeOf(fact('f1', false))).toBe('facts');
    expect(themeOf(fact('f2', true))).toBe('challenges');
  });

  it('maps entities by type', () => {
    expect(themeOf(entity('e1', 'person'))).toBe('people');
    expect(themeOf(entity('e2', 'place'))).toBe('places');
    expect(themeOf(entity('e3', 'location'))).toBe('places');
    expect(themeOf(entity('e4', 'geo'))).toBe('places');
    expect(themeOf(entity('e5', 'org'))).toBe('orgs');
    expect(themeOf(entity('e6', 'organisation'))).toBe('orgs');
    expect(themeOf(entity('e7', 'company'))).toBe('orgs');
    expect(themeOf(entity('e8', 'concept'))).toBe('concepts');
    expect(themeOf(entity('e9', 'event'))).toBe('concepts'); // unknown → concepts
    expect(themeOf(entity('e10', 'Person'))).toBe('people'); // case-insensitive
  });

  it('falls through to "concepts" for an unknown kind', () => {
    expect(themeOf({ id: 'x', kind: 'mystery', fields: {} })).toBe('concepts');
  });

  it('every theme key returned by themeOf appears in THEMES', () => {
    const keys = new Set<ThemeKey>(THEMES.map((t) => t.key));
    const samples: ThemeArtefact[] = [
      src('a', 'example.com'),
      src('b', 'youtube.com'),
      fact('c', false),
      fact('d', true),
      entity('e', 'person'),
      entity('f', 'place'),
      entity('g', 'org'),
      entity('h', 'concept'),
    ];
    for (const s of samples) expect(keys.has(themeOf(s))).toBe(true);
  });
});

describe('themeLayout', () => {
  const mixed: ThemeArtefact[] = [
    src('s1', 'example.com'),
    src('s2', 'youtube.com'), // video
    fact('f1', false),
    fact('f2', true), // challenge
    entity('p1', 'person'),
    entity('pl1', 'place'),
    entity('o1', 'org'),
    entity('c1', 'concept'),
  ];

  it('returns a position for every input card', () => {
    const m = themeLayout(mixed);
    for (const c of mixed) {
      expect(m.has(c.id)).toBe(true);
      const p = m.get(c.id)!;
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect(m.size).toBe(mixed.length);
  });

  it('snaps every position to the grid', () => {
    const m = themeLayout(mixed);
    for (const p of m.values()) {
      expect(p.x % GRID).toBe(0);
      expect(p.y % GRID).toBe(0);
    }
  });

  it('is deterministic', () => {
    expect(themeLayout(mixed)).toEqual(themeLayout(mixed));
  });

  it('groups cards by theme: same-theme cards share an X column, different themes do not overlap', () => {
    // Two sites + two videos. Sites should cluster, videos cluster, and the two
    // clusters must occupy disjoint horizontal ranges.
    const cards: ThemeArtefact[] = [
      src('s1', 'example.com'),
      src('s2', 'other.com'),
      src('v1', 'youtube.com'),
      src('v2', 'vimeo.com'),
    ];
    const m = themeLayout(cards);
    const s1 = m.get('s1')!;
    const s2 = m.get('s2')!;
    const v1 = m.get('v1')!;
    const v2 = m.get('v2')!;
    // Same theme → same column X (they wrap vertically within a small block).
    expect(s1.x).toBe(s2.x);
    expect(v1.x).toBe(v2.x);
    // Different themes → videos block sits entirely to the right of the sites block.
    expect(v1.x).toBeGreaterThan(s1.x);
  });

  it('no two cards from different themes occupy overlapping card boxes', () => {
    const m = themeLayout(mixed);
    // Build per-card boxes tagged with their theme, then assert any two boxes
    // from different themes are non-overlapping.
    const boxes = mixed.map((c) => {
      const p = m.get(c.id)!;
      return {
        theme: themeOf(c),
        x0: p.x,
        y0: p.y,
        x1: p.x + THEME.cardW,
        y1: p.y + THEME.cardH,
      };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.theme === b.theme) continue;
        const overlapX = a.x0 < b.x1 && b.x0 < a.x1;
        const overlapY = a.y0 < b.y1 && b.y0 < a.y1;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it('wraps cards within a theme into multiple columns past rowsPerCol', () => {
    const n = THEME.rowsPerCol + 2; // forces a second column
    const cards: ThemeArtefact[] = Array.from({ length: n }, (_, i) =>
      src(`s${i}`, 'example.com'),
    );
    const m = themeLayout(cards);
    const xs = new Set([...m.values()].map((p) => p.x));
    expect(xs.size).toBe(2); // two columns
  });

  it('skips empty themes (only present themes consume horizontal space)', () => {
    // Only facts present → the single block should start at the origin X.
    const cards: ThemeArtefact[] = [fact('f1'), fact('f2')];
    const m = themeLayout(cards);
    const xs = [...m.values()].map((p) => p.x);
    expect(Math.min(...xs)).toBe(THEME.originX);
  });

  it('lays out in its own zone, spatially distinct from the GATHER scatter region', () => {
    // THEME.originX/originY anchor at THEME_ZONE_ORIGIN, which sits to the RIGHT
    // of the 3 scatter bands — so arranged clusters never share the scatter's
    // coordinate space (which starts at 0,0).
    expect(THEME.originX).toBe(THEME_ZONE_ORIGIN.x);
    expect(THEME.originY).toBe(THEME_ZONE_ORIGIN.y);
    const scatterRightEdge = BAND.originX + 3 * BAND.width;
    expect(THEME_ZONE_ORIGIN.x).toBeGreaterThan(scatterRightEdge);

    // Every laid-out card lands at or past the zone origin (right of the scatter).
    const m = themeLayout([fact('f1'), src('s1', 'example.com')]);
    for (const p of m.values()) {
      expect(p.x).toBeGreaterThanOrEqual(THEME_ZONE_ORIGIN.x);
    }
  });

  it('uses a card height aligned with the real card box (132)', () => {
    expect(THEME.cardH).toBe(132);
  });

  it('handles an empty input', () => {
    expect(themeLayout([]).size).toBe(0);
  });
});

describe('themeHeaders', () => {
  it('returns one header per non-empty theme, in THEMES order, with counts', () => {
    const cards: ThemeArtefact[] = [
      fact('f1'),
      fact('f2'),
      src('s1', 'example.com'),
      entity('p1', 'person'),
    ];
    const headers = themeHeaders(cards);
    const keys = headers.map((h) => h.key);
    // sites < facts < people in THEMES order.
    expect(keys).toEqual(['sites', 'facts', 'people']);
    const byKey = new Map(headers.map((h) => [h.key, h]));
    expect(byKey.get('facts')!.count).toBe(2);
    expect(byKey.get('sites')!.count).toBe(1);
    expect(byKey.get('people')!.count).toBe(1);
  });

  it('aligns each header X with its theme block left edge', () => {
    const cards: ThemeArtefact[] = [
      src('s1', 'example.com'),
      fact('f1'),
    ];
    const layout = themeLayout(cards);
    const headers = themeHeaders(cards);
    for (const h of headers) {
      // The block's cards sit at header.x (col 0) for that theme.
      const memberX = [...layout.entries()]
        .filter(([id]) => cards.find((c) => c.id === id && themeOf(c) === h.key))
        .map(([, p]) => p.x);
      for (const mx of memberX) expect(mx).toBe(h.pos.x);
    }
  });
});
