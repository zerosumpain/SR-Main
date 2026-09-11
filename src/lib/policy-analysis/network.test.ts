/**
 * The relationship readings, and the two things they say about themselves.
 *
 * Six of these readings are structural — a missing counterpart the paper never
 * closes — and they were sound. The faults this file pins are the ones that made
 * the sound readings hard to trust: a headline promising BODIES that named
 * mechanisms, a body counted six times so its degree ranked ninth, and a duty
 * attributed to a charity cited in a footnote. All three were live on the Best
 * Start in Life assessment of 2026-09-11 and none of them is a model's fault.
 *
 * Pure: no database, no mount, no model.
 */
import { describe, expect, it } from 'vitest';
import { artefact, type Artefact } from './contracts';
import { isBody, network } from './network';

const actor = (id: string, label: string, entityType = 'agency', aliases: string[] = []) =>
  artefact(id, 'actor', label, 'x', { entityType, aliases, mentions: [], ambiguity: '', dates: [], parent: null });

const mechanism = (id: string, label: string) => artefact(id, 'mechanism', label, 'x', { operator: null, notes: '' });

const edge = (id: string, from: string, to: string, relation: string, page: number | null = null) =>
  ({ ...artefact(id, 'edge', relation, 'x', { notes: '' }, { page }), fromId: from, toId: to, relation }) as Artefact;

const reading = (all: Artefact[], key: string) => network(all).insights.find((i) => i.key === key);

describe('a body is not a piece of machinery', () => {
  it('admits the two kinds the graph contract allows as an endpoint', () => {
    // `node` has never been seen as an endpoint — 754 were written across every
    // assessment on the box at 2026-09-11 and none was an edge end — but the
    // contract allows one, and the contract decides.
    expect(isBody({ kind: 'actor' })).toBe(true);
    expect(isBody({ kind: 'node' })).toBe(true);
    expect(isBody({ kind: 'mechanism' })).toBe(false);
    expect(isBody({ kind: 'claim' })).toBe(false);
  });

  it('names only bodies under a headline that says bodies', () => {
    // Live defect: "The bodies the policy runs through" listed "Tailored support
    // after inspections" and "Enhanced reception offer" among its five.
    const all: Artefact[] = [
      actor('gov', 'Government'),
      mechanism('m1', 'Enhanced reception offer'),
      ...Array.from({ length: 4 }, (_, i) => edge(`e${i}`, 'gov', 'm1', 'is_accountable_for')),
    ];
    const bodies = reading(all, 'load-bearing');
    expect(bodies?.subjects.map((s) => s.label)).toEqual(['Government']);
  });

  it('gives the machinery its own reading rather than dropping it', () => {
    // On a paper written as beneficiaries-and-delivery the machinery is the
    // busier half, and it is what a play actually aims at.
    const all: Artefact[] = [
      actor('gov', 'Government'),
      mechanism('m1', 'Enhanced reception offer'),
      ...Array.from({ length: 4 }, (_, i) => edge(`e${i}`, 'gov', 'm1', 'is_accountable_for')),
    ];
    const machinery = reading(all, 'load-bearing-machinery');
    expect(machinery?.subjects.map((s) => s.label)).toEqual(['Enhanced reception offer']);
  });
});

describe('one body recorded six times', () => {
  // Live: 267 bodies holding 21 groups the site's matcher puts at or above its
  // auto-merge threshold — six of them the word "Government", seven "Local
  // authorities" — so the busiest institution in the paper ranked ninth.
  const duplicated: Artefact[] = [
    actor('g1', 'Government'),
    actor('g2', 'Government'),
    actor('g3', 'The Government'),
    actor('la', 'Local authorities'),
    mechanism('m1', 'Funded hours'),
    edge('e1', 'g1', 'm1', 'funds'),
    edge('e2', 'g2', 'm1', 'funds'),
    edge('e3', 'g3', 'm1', 'funds'),
    edge('e4', 'la', 'm1', 'delivers'),
  ];

  it('reports the group, with the degree the copies are splitting between them', () => {
    const dupes = reading(duplicated, 'duplicate-bodies');
    expect(dupes?.subjects).toHaveLength(1);
    expect(dupes?.subjects[0].label).toBe('Government');
    expect(dupes?.subjects[0].note).toContain('3 separate bodies');
    expect(dupes?.subjects[0].note).toContain('3 relationships');
  });

  it('REPORTS and never merges, because a conflated hub invents adjacency', () => {
    // Folding them was measured on the live assessment: it moves the best
    // possible grid from four live cells to five, while three of the eight
    // largest groups swallow a distinct body ("Schools" taking "early years
    // settings"). The graph is left exactly as the pipeline built it.
    const net = network(duplicated);
    const governments = net.nodes.filter((n) => n.label.toLowerCase().includes('government'));
    expect(governments.map((n) => n.id).sort()).toEqual(['g1', 'g2', 'g3']);
    // Three nodes of degree one, not one node of degree three — the split is
    // reported, not repaired.
    expect(governments.map((n) => n.degree)).toEqual([1, 1, 1]);
  });

  it('does not serve a stale answer when the graph grows under the poll', () => {
    // The scan is memoised because it is 95ms of a 100ms `network()` and the
    // dashboard replaces its artefacts wholesale every six seconds while a run
    // is active. A memo on a hot path is only safe if a changed graph misses it.
    expect(reading(duplicated, 'duplicate-bodies')?.subjects[0].note).toContain('3 separate bodies');
    const grown = [...duplicated, actor('g4', 'Government'), edge('e5', 'g4', 'm1', 'funds')];
    expect(reading(grown, 'duplicate-bodies')?.subjects[0].note).toContain('4 separate bodies');
    const renamed = [...duplicated.filter((a) => a.id !== 'g3'), actor('g3', 'Ofsted')];
    expect(reading(renamed, 'duplicate-bodies')?.subjects[0].note).toContain('2 separate bodies');
  });

  it('says nothing at all when every body is named once', () => {
    const clean: Artefact[] = [
      actor('gov', 'Government'),
      actor('ofsted', 'Ofsted'),
      mechanism('m1', 'Funded hours'),
      edge('e1', 'gov', 'm1', 'funds'),
      edge('e2', 'ofsted', 'm1', 'is_measured_by'),
    ];
    expect(reading(clean, 'duplicate-bodies')).toBeUndefined();
  });
});

describe('a duty hung on the nearest named organisation', () => {
  // Nesta, on the live assessment: eighteen `is_accountable_for` edges covering
  // the workforce chapter, an in-degree of zero, and second place in the busiest
  // bodies on the page. A charity cited in the evidence had been handed the
  // department's commitments.
  const attributed = (count: number, pages: (number | null)[] = []) => [
    actor('nesta', 'Nesta', 'charity'),
    ...Array.from({ length: count }, (_, i) => mechanism(`m${i}`, `Commitment ${i}`)),
    ...Array.from({ length: count }, (_, i) => edge(`e${i}`, 'nesta', `m${i}`, 'is_accountable_for', pages[i] ?? null)),
  ];

  it('names a body carrying several duties that nothing points back at', () => {
    const unwired = reading(attributed(4, [26, 33, 35, 37]), 'attributed-but-unconnected');
    expect(unwired?.subjects[0].label).toBe('Nesta');
    expect(unwired?.subjects[0].note).toContain('4 duties attributed');
    // A contiguous run of pages is the strongest tell that a name was picked up
    // from the page rather than from the sentence.
    expect(unwired?.subjects[0].note).toContain('pages 26–37');
  });

  it('holds its tongue below the floor, because one unanswered duty is normal', () => {
    expect(reading(attributed(2, [26, 27]), 'attributed-but-unconnected')).toBeUndefined();
  });

  it('says nothing when the paper does wire the body up', () => {
    const wired: Artefact[] = [
      ...attributed(4, [26, 33, 35, 37]),
      actor('dfe', 'Department for Education'),
      edge('funds', 'dfe', 'nesta', 'funds'),
    ];
    expect(reading(wired, 'attributed-but-unconnected')).toBeUndefined();
  });

  it('leads with the caveats, because they change how everything under them reads', () => {
    const all = [
      ...attributed(4, [26, 33, 35, 37]),
      actor('g1', 'Government'),
      actor('g2', 'Government'),
      edge('x1', 'g1', 'm0', 'funds'),
      edge('x2', 'g2', 'm1', 'funds'),
    ];
    expect(network(all).insights.slice(0, 2).map((i) => i.key)).toEqual([
      'duplicate-bodies',
      'attributed-but-unconnected',
    ]);
  });
});
