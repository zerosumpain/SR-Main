import { describe, it, expect } from 'vitest';
import {
  correlateStories,
  matchAnchor,
  summariseByAnchor,
  STRENGTH_FLOOR,
  type Anchor,
} from './correlate';
import type { NewsStory } from './types';

function story(partial: Partial<NewsStory> & { title: string }): NewsStory {
  return {
    key: partial.key ?? `k-${partial.title}`,
    source: partial.source ?? 'hacker-news',
    sourceLabel: 'Hacker News',
    id: partial.id ?? '1',
    title: partial.title,
    url: 'https://example.com/a',
    discussionUrl: 'https://news.ycombinator.com/item?id=1',
    domain: partial.domain ?? 'example.com',
    author: null,
    publishedAt: new Date().toISOString(),
    score: partial.score ?? 100,
    commentCount: 0,
    tags: [],
    summary: partial.summary ?? '',
    rank: partial.rank ?? 1,
    canonicalUrl: partial.canonicalUrl ?? 'example.com/a',
    alsoOn: partial.alsoOn ?? [],
  };
}

function anchor(partial: Partial<Anchor> & { name: string }): Anchor {
  return {
    id: partial.id ?? `a-${partial.name}`,
    name: partial.name,
    aliases: partial.aliases ?? [],
    kind: partial.kind ?? 'entity',
    importance: partial.importance ?? 0.8,
    why: partial.why ?? 'watched entity',
  };
}

describe('matchAnchor', () => {
  it('matches a multi-word name as a phrase', () => {
    const m = matchAnchor(story({ title: 'The Data Spine is finally shipping' }), anchor({ name: 'Data Spine' }));
    expect(m?.strength).toBe('phrase');
    expect(m?.matched).toBe('Data Spine');
  });

  it('does not match a multi-word name whose words are merely both present', () => {
    const m = matchAnchor(
      story({ title: 'Spine surgery and the data behind it' }),
      anchor({ name: 'Data Spine' }),
    );
    expect(m).toBeNull();
  });

  // The classic failure of every name-match rule ever written.
  it('will not match a name inside a longer word', () => {
    expect(matchAnchor(story({ title: 'A trusted approach to memory' }), anchor({ name: 'Rust' }))).toBeNull();
    expect(matchAnchor(story({ title: 'Rust 2.0 released' }), anchor({ name: 'Rust' }))?.strength).toBe('name');
  });

  it('ignores single words that are ordinary English', () => {
    expect(matchAnchor(story({ title: 'A new model for search' }), anchor({ name: 'Search' }))).toBeNull();
    expect(matchAnchor(story({ title: 'Health data goes public' }), anchor({ name: 'Health' }))).toBeNull();
  });

  it('matches an alias when the display name is absent', () => {
    const m = matchAnchor(
      story({ title: 'Postgres 18 lands' }),
      anchor({ name: 'PostgreSQL', aliases: ['Postgres'] }),
    );
    expect(m?.matched).toBe('Postgres');
  });

  // Lower-cased, `ons` collides with ordinary text; capitalised in a headline it
  // is almost always the organisation.
  it('matches an acronym only when the headline capitalises it', () => {
    const a = anchor({ name: 'Office for National Statistics' });
    expect(matchAnchor(story({ title: 'ONS publishes new figures' }), a)?.strength).toBe('acronym');
    expect(matchAnchor(story({ title: 'the ons figures were quiet' }), a)).toBeNull();
  });

  /**
   * The limitation, pinned rather than papered over. `acronymsOf` builds
   * initials from SIGNIFICANT tokens, so it drops "for" and yields `de` for the
   * Department for Education — it can never produce `DfE`. Acronyms that skip a
   * preposition have to arrive as an alias, which is where they actually live:
   * the intel `aliases` column is written by merges. If this ever starts
   * passing, `acronymsOf` changed and this file should say so.
   */
  it('cannot derive an acronym that skips a preposition — that needs an alias', () => {
    const derived = anchor({ name: 'Department for Education' });
    expect(matchAnchor(story({ title: 'DfE publishes new guidance' }), derived)).toBeNull();

    const withAlias = anchor({ name: 'Department for Education', aliases: ['DfE'] });
    expect(matchAnchor(story({ title: 'DfE publishes new guidance' }), withAlias)?.matched).toBe('DfE');
  });

  it('scores a phrase above a bare name above an acronym', () => {
    const imp = { importance: 1 };
    const phrase = matchAnchor(story({ title: 'On the Data Spine' }), anchor({ name: 'Data Spine', ...imp }));
    const name = matchAnchor(story({ title: 'On Kubernetes' }), anchor({ name: 'Kubernetes', ...imp }));
    const acro = matchAnchor(story({ title: 'ONS releases figures' }), anchor({ name: 'Office for National Statistics', ...imp }));
    expect(phrase!.score).toBeGreaterThan(name!.score);
    expect(name!.score).toBeGreaterThan(acro!.score);
  });

  it('scales the score by how much the element matters', () => {
    const strong = matchAnchor(story({ title: 'Kubernetes news' }), anchor({ name: 'Kubernetes', importance: 1 }));
    const weak = matchAnchor(story({ title: 'Kubernetes news' }), anchor({ name: 'Kubernetes', importance: 0.2 }));
    expect(strong!.score).toBeGreaterThan(weak!.score);
  });
});

describe('correlateStories', () => {
  // Both clear the floor: 0.9 phrase = 0.9, 0.9 single word = 0.558. A 0.5
  // single word would score 0.31 and be dropped — which is the floor's job, and
  // is pinned in its own case below.
  const anchors = [
    anchor({ name: 'Data Spine', importance: 0.9, id: 'spine' }),
    anchor({ name: 'Kubernetes', importance: 0.9, id: 'k8s' }),
  ];

  it('drops stories that match nothing rather than returning them at zero', () => {
    const out = correlateStories([story({ title: 'A story about nothing in particular' })], anchors);
    expect(out).toEqual([]);
  });

  it('ranks by score, then by the wire\'s own order', () => {
    const out = correlateStories(
      [
        story({ title: 'Kubernetes gets a scheduler', rank: 1 }),
        story({ title: 'The Data Spine explained', rank: 9 }),
      ],
      anchors,
    );
    expect(out.map((c) => c.story.title)).toEqual([
      'The Data Spine explained',
      'Kubernetes gets a scheduler',
    ]);
  });

  it('honours the floor — a weak element in a headline is not a strong correlation', () => {
    const faint = [anchor({ name: 'Kubernetes', importance: 0.1 })];
    expect(correlateStories([story({ title: 'Kubernetes news' })], faint)).toEqual([]);
    expect(correlateStories([story({ title: 'Kubernetes news' })], faint, { floor: 0 })).toHaveLength(1);
  });

  /**
   * The two real cases the floors were calibrated against, from the live wire on
   * 2026-09-02. They pull in opposite directions, which is why the floor is per
   * strength rather than one number.
   */
  it('admits a confirmed entity named in a headline', () => {
    const pg = [anchor({ id: 'pg', name: 'PostgreSQL', importance: 0.5 })];
    const out = correlateStories(
      [story({ title: 'New things for regular expressions in PostgreSQL (pg_tre and pg_re2)' })],
      pg,
    );
    expect(out).toHaveLength(1);
    expect(out[0].matches[0].score).toBeCloseTo(0.31, 2);
  });

  it('rejects an acronym coincidence at the same score', () => {
    const csub = [anchor({ id: 'cs', name: 'Corporate Services subcommittee', importance: 0.2 })];
    expect(correlateStories([story({ title: 'Is Minifying CSS Necessary? (2023)' })], csub)).toEqual([]);
  });

  it('caps how many elements one headline is said to be about', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      anchor({ id: `e${i}`, name: `Widget${i}`, importance: 1 }),
    );
    const out = correlateStories(
      [story({ title: 'Widget0 Widget1 Widget2 Widget3 Widget4 Widget5 all at once' })],
      many,
    );
    expect(out[0].matches).toHaveLength(3);
  });

  it('sets a higher bar for an acronym than for a name', () => {
    // The ordering is the whole point: an acronym is a coincidence generator,
    // a multi-word phrase is nearly proof.
    expect(STRENGTH_FLOOR.acronym).toBeGreaterThan(STRENGTH_FLOOR.name);
    expect(STRENGTH_FLOOR.name).toBeGreaterThan(STRENGTH_FLOOR.phrase);
  });
});

describe('summariseByAnchor — the shape the daydream pack is allowed to see', () => {
  it('collapses stories into first-party facts and carries no headline text', () => {
    const out = summariseByAnchor(
      correlateStories(
        [
          story({ title: 'The Data Spine explained', source: 'hacker-news' }),
          story({ title: 'More on the Data Spine', source: 'lobsters' }),
        ],
        [anchor({ id: 'spine', name: 'Data Spine', importance: 0.9, why: 'watched entity' })],
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      anchorId: 'spine',
      anchorName: 'Data Spine',
      why: 'watched entity',
      storyCount: 2,
    });
    expect(out[0].sources.sort()).toEqual(['hacker-news', 'lobsters']);
    // The guarantee: nothing a stranger typed is in this object.
    expect(JSON.stringify(out)).not.toContain('explained');
  });
});
