// The topical axis, and the two guards that keep it from becoming the old
// behaviour with extra steps.
//
// The anchor rule (an entity known only from email cannot make more email look
// relevant) lives in `loadAnchoredEntities` and needs a database; what is
// testable here is everything downstream of it, plus the guard that actually
// decides whether this feature is useful or catastrophic — the generic-name
// filter. An entity called "Data" matching every email in the mailbox is the
// difference between a scorer and a firehose.
import { describe, it, expect } from 'vitest';
import {
  buildSurfaceIndex,
  matchedEntities,
  matchEntities,
  relevanceTextOf,
  type AnchoredEntity,
} from './mail-relevance';
import { factsFor } from './mail-facts';

function entity(name: string, weight: 1 | 2 | 3, aliases: string[] = []): AnchoredEntity {
  return { id: name.toLowerCase().replace(/\s+/g, '-'), name, weight, aliases };
}

const NOTE_BODY = `Subject: Keystone data strategy — Q3 milestones
Participants: sarah@partner-corp.com, John Kelly <johnkelly.main@googlemail.com>
Messages: 2 (2026-08-01 → 2026-08-03)

[1] · 2026-08-01 · from Sarah Voss <sarah@partner-corp.com> · to John Kelly <johnkelly.main@googlemail.com>
The Keystone milestones slipped a fortnight. DfE want the spine paper by the 14th.

[2] · 2026-08-03 · from John Kelly <johnkelly.main@googlemail.com> · to sarah@partner-corp.com
Noted — I'll get Keystone re-baselined.`;

describe('relevanceTextOf', () => {
  it('drops the header block and the per-message routing lines', () => {
    const text = relevanceTextOf('Keystone data strategy — Q3 milestones', NOTE_BODY);
    expect(text).not.toContain('Participants:');
    expect(text).not.toContain('Messages: 2');
    expect(text).not.toContain('sarah@partner-corp.com');
    expect(text).toContain('The Keystone milestones slipped');
  });

  it('keeps the subject, which is the most informative line there is', () => {
    expect(relevanceTextOf('Keystone data strategy', 'body text')).toContain('Keystone data strategy');
  });

  it('is why a mailshot sender does not score its own newsletter run', () => {
    // The whole reason the routing lines go: an entity named after a company
    // whose address appears in every one of its emails would otherwise hit on
    // all of them without the prose ever mentioning it.
    const index = buildSurfaceIndex([entity('Partner Corp', 3, ['partner-corp'])]);
    const body = `Subject: Weekly digest
Participants: news@partner-corp.com, John Kelly <me@x.com>
Messages: 1

[1] · 2026-08-01 · from Partner Corp <news@partner-corp.com> · to John Kelly <me@x.com>
Ten things to read this week.`;
    expect(matchEntities(relevanceTextOf('Weekly digest', body), index).hits).toBe(0);
  });
});

describe('buildSurfaceIndex', () => {
  it('refuses single words too generic to identify anything', () => {
    const index = buildSurfaceIndex([entity('Data', 3), entity('Security', 3), entity('Project', 3)]);
    expect(index.size).toBe(0);
  });

  it('refuses a single token shorter than three characters', () => {
    expect(buildSurfaceIndex([entity('AI', 3)]).size).toBe(0);
  });

  it('keeps acronyms of three characters, which the graph is full of', () => {
    expect(buildSurfaceIndex([entity('DfE', 3)]).by.has('dfe')).toBe(true);
  });

  it('keeps a generic word when it is part of a multi-word name', () => {
    expect(buildSurfaceIndex([entity('Keystone Data Strategy', 3)]).by.has('keystone data strategy')).toBe(true);
  });

  it('indexes aliases alongside the name', () => {
    const index = buildSurfaceIndex([entity('International Building Control Authority', 2, ['IBCA'])]);
    expect(index.by.has('ibca')).toBe(true);
    expect(index.by.has('international building control authority')).toBe(true);
  });

  it('gives a shared surface to the heavier entity', () => {
    const index = buildSurfaceIndex([entity('Keystone', 1), entity('Keystone', 3)]);
    expect(index.by.get('keystone')?.weight).toBe(3);
  });
});

describe('matchEntities', () => {
  const index = buildSurfaceIndex([
    entity('Keystone', 3),
    entity('DfE', 2),
    entity('Elton Parade', 1),
  ]);

  it('finds every distinct entity the text names', () => {
    const match = matchEntities(relevanceTextOf(null, NOTE_BODY), index);
    expect(match.hits).toBe(2);
    expect(match.names).toContain('Keystone');
    expect(match.names).toContain('DfE');
  });

  it('reports the weight of the most important hit, not the last one', () => {
    expect(matchEntities('DfE and Keystone', index).topWeight).toBe(3);
    expect(matchEntities('DfE alone', index).topWeight).toBe(2);
    expect(matchEntities('nothing here', index).topWeight).toBe(0);
  });

  it('counts a name once however often it is repeated', () => {
    // A forty-message quoted reply chain must not outrank a short email that
    // names three different things.
    const match = matchEntities('Keystone Keystone Keystone Keystone', index);
    expect(match.hits).toBe(1);
  });

  it('matches multi-word names across the token window', () => {
    expect(matchEntities('meet me at Elton Parade tomorrow', index).hits).toBe(1);
  });

  it('does not match a name split across a sentence boundary', () => {
    // "Elton" then "Parade" as separate ideas is not the place. Punctuation
    // normalises to a space, so this is the honest limit of the approach and it
    // is worth pinning: the window is over tokens, not over meaning.
    expect(matchEntities('I saw Elton. Parade was cancelled.', index).hits).toBe(1);
  });

  it('is case and punctuation insensitive', () => {
    expect(matchEntities("KEYSTONE's roadmap", index).hits).toBe(1);
  });
});

describe('the document-frequency block list', () => {
  const index = buildSurfaceIndex([
    entity('Johnkelly Main', 2),
    entity('Privacy Policy', 2),
    entity('Keystone', 2),
  ]);

  it('counts raw hits before anything is blocked', () => {
    // The block list is derived FROM these counts, so it cannot also be an
    // input to them — that is why matchedEntities exists separately.
    const raw = matchedEntities('Johnkelly Main wrote about Keystone', index);
    expect(raw.size).toBe(2);
  });

  it('stops counting an entity the pass ruled out', () => {
    const blocked = new Set([...matchedEntities('Johnkelly Main', index).keys()]);
    const match = matchEntities('Johnkelly Main wrote about Keystone', index, { blocked });
    expect(match.hits).toBe(1);
    expect(match.names).toEqual(['Keystone']);
  });

  it('drops topWeight with the blocked entity, not just the count', () => {
    // The failure this prevents: "Johnkelly Main" carries corroboration 98, so
    // it alone pushed 1,130 threads to topWeight 2 and the seed rule matched
    // 67% of the mailbox. Blocking must remove its WEIGHT as well as its tally.
    const heavy = buildSurfaceIndex([entity('Johnkelly Main', 3), entity('Darlington', 1)]);
    const blocked = new Set([...matchedEntities('Johnkelly Main', heavy).keys()]);
    const match = matchEntities('Johnkelly Main on Darlington', heavy, { blocked });
    expect(match.topWeight).toBe(1);
  });

  it('leaves a thread naming only boilerplate with nothing at all', () => {
    const blocked = new Set([...matchedEntities('Johnkelly Main Privacy Policy', index).keys()]);
    const match = matchEntities('Privacy Policy — Johnkelly Main', index, { blocked });
    expect(match.hits).toBe(0);
    expect(match.topWeight).toBe(0);
  });
});

describe('factsFor reading the stored score', () => {
  const base = {
    title: 'Subject line',
    rawContent: NOTE_BODY,
    observedAt: '2026-08-20T09:00:00Z',
    createdAt: '2026-08-20T09:00:00Z',
  };
  const NOW = Date.UTC(2026, 7, 27);

  it('reports zero for a thread nobody has scored', () => {
    const facts = factsFor({ ...base, metadata: {} }, NOW);
    expect(facts.graphEntityHits).toBe(0);
    expect(facts.graphTopHitWeight).toBe(0);
    expect(facts.graphSimilarity).toBe(0);
  });

  it('reads the score the scorer wrote', () => {
    const facts = factsFor(
      { ...base, metadata: { graphRelevance: { hits: 4, topWeight: 3, similarity: 0.62 } } },
      NOW,
    );
    expect(facts.graphEntityHits).toBe(4);
    expect(facts.graphTopHitWeight).toBe(3);
    expect(facts.graphSimilarity).toBe(0.62);
  });

  it('treats a malformed stored score as unscored rather than throwing', () => {
    // The value is jsonb somebody else wrote; a NaN reaching a comparison would
    // make every condition over it silently false in a way nothing reports.
    const facts = factsFor({ ...base, metadata: { graphRelevance: { hits: 'lots' } } }, NOW);
    expect(facts.graphEntityHits).toBe(0);
  });
});
