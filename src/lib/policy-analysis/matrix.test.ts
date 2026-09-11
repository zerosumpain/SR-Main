/**
 * The three grids, and the definitions behind their column headers.
 *
 * All pure: no database, no mount. Each test names the defect it exists for —
 * these derivations replaced three walls of stacked cards, and the mistakes
 * available here are the quiet kind (a clip that eats a word, a cap that hides
 * a body without saying so, a column that is blank for everybody).
 */
import { describe, expect, it } from 'vitest';
import { artefact, type Artefact } from './contracts';
import { KEY_SECTIONS, STRUCTURE_TERMS, explain, explainable, familyTermKey } from './glossary';
import {
  CELL_CHARS,
  MIN_GRID_EDGES,
  PLAY_FACTORS,
  TRAIT_COLUMNS,
  adjacency,
  axisLabel,
  bodyLinks,
  cellSentence,
  clip,
  playGrid,
  traitCoverage,
  traitGrid,
  unplacedEdges,
} from './matrix';
import { network } from './network';
import { plays as playsOf, type ActorView } from './view';

const field = (value: string, origin = 'structural_inference') => ({ value, origin, confidence: null, refs: [] });

const actorOf = (id: string, label: string, mentions: string[] = []) =>
  artefact(id, 'actor', label, 'x', {
    entityType: 'agency',
    aliases: [],
    mentions,
    ambiguity: '',
    dates: [],
    parent: null,
  });

const profileOf = (id: string, actorId: string, over: Record<string, unknown> = {}) =>
  artefact(id, 'profile', 'Profile', 'x', {
    actorId,
    accountableTo: field('Ministers, through an annual report'),
    successCriteria: field('Volume of compliant cases closed'),
    timeHorizon: field('One reporting year'),
    informationControlled: field('The inspection schedule'),
    outsideOption: field('Absorb the cost quietly'),
    gainFromFailure: field('A weaker regime means less to evidence', 'behavioural_hypothesis'),
    ...over,
  });

// `factors` carries the band alongside the four numbers, because `scoreExploits`
// runs in the pipeline and not at load — a play inserted without one vanishes
// from every ranked view, which is the trap this feature has already paid for.
const exploitOf = (
  id: string,
  actorId: string,
  label: string,
  factors: Record<string, number | string>,
  over: Record<string, unknown> = {},
) =>
  artefact(id, 'exploit', label, 'x', {
    actorId,
    motivation: 'm',
    play: 'Do exactly what the standard requires and no more, choosing the reading that costs least of all.',
    legality: 'compliant',
    targets: ['s2_mech'],
    preconditions: ['s1_a'],
    payoff: 'p',
    costToPolicy: 'c',
    counter: 'x',
    earlyWarning: 'w',
    precedent: '',
    exposure: 0,
    band: 'limited',
    ...factors,
    ...over,
  });

const board = (actors: Artefact[], profiles: Artefact[], all: Artefact[]): ActorView[] => {
  const list = playsOf(all);
  return actors.map((actor) => {
    const mine = list.filter((p) => p.actor?.id === actor.id);
    return {
      actor,
      profile: profiles.find((p) => p.data.actorId === actor.id) ?? null,
      plays: mine,
      worst: mine[0]?.exposure ?? 0,
    };
  });
};

describe('a grid cell is clipped on a word boundary, and says so', () => {
  it('leaves short text exactly as written', () => {
    expect(clip('Its own board')).toEqual({ text: 'Its own board', clipped: false });
  });

  it('never cuts mid-word, and never ends on punctuation', () => {
    const long = 'Ministers, through an annual report laid before Parliament each autumn, with a summary';
    const { text, clipped } = clip(long);
    expect(clipped).toBe(true);
    expect(text.endsWith('…')).toBe(true);
    // The word before the ellipsis is a whole word from the input.
    const last = text.slice(0, -1).trim().split(' ').pop()!;
    expect(long.split(/[\s,]+/)).toContain(last);
    expect(text).not.toMatch(/[,;:.]…$/);
  });

  it('collapses the newlines a PDF extraction leaves behind', () => {
    expect(clip('what\nlandlords  achieve').text).toBe('what landlords achieve');
  });

  it('falls back to a hard cut rather than losing most of the cell', () => {
    // One 80-character word: there is no boundary to break on, and returning
    // the first six characters because that is where a space happened to be
    // would be worse than a hard cut.
    const { text } = clip('a'.repeat(80));
    expect(text.length).toBeGreaterThan(CELL_CHARS * 0.6);
  });
});

describe('the cast is one table, not nine cards', () => {
  const actors = [actorOf('s2_a', 'Regulator of Social Housing', ['p1', 'p2']), actorOf('s2_b', 'Tenant panels', ['p1'])];
  const profiles = [profileOf('s5_a', 's2_a'), profileOf('s5_b', 's2_b')];
  const exploits = [
    exploitOf('s11_1', 's2_a', 'Report against the easiest measure', { incentive: 0.9, ease: 0.85, impact: 0.8, concealment: 0.8, exposure: 0.84, band: 'severe' }),
    exploitOf('s11_2', 's2_a', 'Defer inspection', { incentive: 0.5, ease: 0.5, impact: 0.5, concealment: 0.5, exposure: 0.5, band: 'significant' }),
  ];
  const all = [...actors, ...profiles, ...exploits];
  const rows = traitGrid(board(actors, profiles, all), []);

  it('gives every body one row and every question one column', () => {
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.cells).toHaveLength(TRAIT_COLUMNS.length);
  });

  it('orders by the worst play each body could run, as the cards did', () => {
    expect(rows.map((r) => r.label)).toEqual(['Regulator of Social Housing', 'Tenant panels']);
    expect(rows[0].worst).toBe(84);
    expect(rows[0].playCount).toBe(2);
    expect(rows[0].topPlay?.label).toBe('Report against the easiest measure');
  });

  it('leaves a body with no play as an absence, never as a zero', () => {
    // An empty bar with a name beside it reads as something the assessment
    // measured. `topPlay` being null is what lets the cell say "none found".
    expect(rows[1].topPlay).toBeNull();
    expect(rows[1].band).toBeNull();
  });

  it('keeps the profile id, so a cell can open the dossier rather than the actor', () => {
    expect(rows[0].profileId).toBe('s5_a');
  });

  it('marks a body the reader has met before', () => {
    const known = traitGrid(board(actors, profiles, all), [{ actorId: 's2_b' }]);
    expect(known.find((r) => r.id === 's2_b')?.known).toBe(true);
    expect(known.find((r) => r.id === 's2_a')?.known).toBe(false);
  });

  it('reports coverage, and names a column nobody filled', () => {
    const thin = traitGrid(
      board(actors, [profileOf('s5_a', 's2_a', { gainFromFailure: undefined }), profileOf('s5_b', 's2_b', { gainFromFailure: undefined })], all),
      [],
    );
    const coverage = traitCoverage(thin);
    expect(coverage.total).toBe(2 * TRAIT_COLUMNS.length);
    expect(coverage.filled).toBe(coverage.total - 2);
    expect(coverage.silent).toEqual(['Gains if it fails']);
  });

  it('states the dominant origin ONCE so a cell only labels itself when it differs', () => {
    // The live assessment carried the words "structural inference" under all 54
    // cells, which is true and hides the values it annotates. Five of the six
    // columns here are structural; `gainFromFailure` is a hypothesis.
    const coverage = traitCoverage(rows);
    expect(coverage.dominantOrigin).toBe('structural_inference');
    expect(coverage.exceptions).toBe(2);
  });

  it('claims no dominant origin when the profiles genuinely disagree', () => {
    const mixed = traitGrid(
      board(
        actors,
        [
          profileOf('s5_a', 's2_a', { accountableTo: field('x', 'extracted_fact'), successCriteria: field('y', 'external_evidence') }),
          profileOf('s5_b', 's2_b', { timeHorizon: field('z', 'model_result'), outsideOption: field('w', 'prior_assessment') }),
        ],
        all,
      ),
      [],
    );
    expect(traitCoverage(mixed).dominantOrigin).toBeNull();
  });
});

describe('the playbook is a ranked table', () => {
  const all = [
    actorOf('s2_a', 'Regulator of Social Housing'),
    exploitOf('s11_1', 's2_a', 'Report against the easiest measure', { incentive: 0.92, ease: 0.85, impact: 0.78, concealment: 0.8, exposure: 0.84, band: 'severe' }, { targets: ['m1', 'm2', 'm3'] }),
    exploitOf('s11_2', 's2_a', 'Defer inspection', { incentive: 0.5, ease: 0.5, impact: 0.5, concealment: 0.5, exposure: 0.5, band: 'significant' }, { legality: 'grey' }),
  ];
  const rows = playGrid(playsOf(all));

  it('ranks from 1 and keeps the four factors in the order the arithmetic uses', () => {
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(rows[0].factors.map((f) => f.key)).toEqual([...PLAY_FACTORS]);
    expect(rows[0].factors.map((f) => f.value)).toEqual([92, 85, 78, 80]);
  });

  it('scales the computed figure the same way as the factors it is computed from', () => {
    // 0–100 throughout, so the reader can see the blend rather than converting.
    expect(rows[0].exposure).toBe(84);
    expect(rows[0].band).toBe('severe');
  });

  it('carries the actor and how many parts of the machinery the play aims at', () => {
    expect(rows[0].actor).toEqual({ id: 's2_a', label: 'Regulator of Social Housing' });
    expect(rows[0].targets).toBe(3);
    expect(rows[1].targets).toBe(1);
  });

  it('keeps the full sentence beside the clipped one', () => {
    expect(rows[0].summary.length).toBeLessThanOrEqual(97);
    expect(rows[0].full.length).toBeGreaterThanOrEqual(rows[0].summary.length);
  });

  it('reports legality rather than assuming compliance', () => {
    expect(rows.map((r) => r.legality)).toEqual(['compliant', 'grey']);
  });

  it('ranks over the whole playbook, so a filter cannot renumber it', () => {
    // The rank column is a play's place in the WHOLE playbook. Ranking the
    // filtered list instead would put "01" against the ninth-worst play the
    // moment a reader narrowed to one band.
    const ids = new Set(['s11_2']);
    const filtered = playGrid(playsOf(all)).filter((r) => ids.has(r.id));
    expect(filtered.map((r) => r.rank)).toEqual([2]);
  });
});

describe('bodies × bodies shows the shape the family panels could not', () => {
  const edge = (id: string, from: string, to: string, relation: string) =>
    ({ ...artefact(id, 'edge', relation, 'x', { notes: '' }), fromId: from, toId: to, relation }) as Artefact;

  const all: Artefact[] = [
    actorOf('a', 'Regulator of Social Housing'),
    actorOf('b', 'Large registered providers'),
    actorOf('c', 'Department for Levelling Up'),
    edge('e1', 'a', 'b', 'regulates'),
    edge('e2', 'a', 'b', 'sanctions'),
    edge('e3', 'b', 'a', 'reports_to'),
    edge('e4', 'c', 'a', 'funds'),
  ];
  const net = network(all);
  const grid = adjacency(net);

  it('puts the busiest bodies on both axes', () => {
    expect(grid.bodies.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(grid.bodies[0].degree).toBe(4);
  });

  it('folds several relations on one pair into one cell, ordered by family', () => {
    const cell = grid.rows[0][1];
    expect(cell?.relations).toEqual(['regulates', 'sanctions']);
    expect(cell?.families).toEqual(['authority']);
    expect(cell?.ids).toEqual(['e1', 'e2']);
  });

  it('separates the two directions, which is the whole reading', () => {
    // a → b is authority; b → a is accountability. Collapsing the pair would
    // erase the one thing the grid is for.
    expect(grid.rows[1][0]?.families).toEqual(['accountability']);
    expect(grid.rows[1][2]).toBeNull();
  });

  it('counts reciprocal and one-way pairs over the DRAWN grid', () => {
    expect(grid.reciprocal).toBe(1);
    expect(grid.oneWay).toBe(1);
  });

  it('never places a body against itself', () => {
    for (let i = 0; i < grid.bodies.length; i++) expect(grid.rows[i][i]).toBeNull();
  });

  it('says how much of the graph is on screen', () => {
    expect(grid.shown).toBe(4);
    expect(grid.total).toBe(4);
    expect(grid.omitted).toEqual([]);
    expect(unplacedEdges(net, grid)).toEqual([]);
  });

  it('caps the axes and NAMES what it left off', () => {
    // A picture of half a graph that does not say so is worse than a list.
    const capped = adjacency(net, 2);
    expect(capped.bodies).toHaveLength(2);
    expect(capped.omitted.map((b) => b.label)).toEqual(['Department for Levelling Up']);
    expect(capped.shown).toBe(3);
    expect(capped.total).toBe(4);
    expect(unplacedEdges(net, capped).map((e) => e.artefact.id)).toEqual(['e4']);
  });

  it('writes the sentence a cell explains itself with', () => {
    expect(cellSentence('Regulator', 'Providers', grid.rows[0][1]!)).toBe(
      'Regulator regulates Providers, and one more relationship.',
    );
    expect(cellSentence('Providers', 'Regulator', grid.rows[1][0]!)).toBe('Providers reports to Regulator.');
  });

  it('reports what a bodies-against-bodies grid could EVER hold, not the whole graph', () => {
    // "0 of 452 (0%)" was the caption on a live assessment whose graph was fine:
    // 420 of those 452 ran from a body to a piece of machinery and were never
    // grid material. The denominator the reader needs is the placeable one.
    expect(grid.placeable).toBe(4);
    expect(grid.total).toBe(4);
  });

  it('counts a row by the links the grid draws, because that is what orders it', () => {
    expect(grid.bodies.map((b) => b.links)).toEqual([4, 3, 1]);
  });

  it('shortens an axis label without inventing an abbreviation', () => {
    // "DLUHC" is a real abbreviation; one invented for "Large registered
    // providers" would not be, so the label is truncated rather than initialled.
    const cut = axisLabel('Department for Levelling Up, Housing and Communities', 16);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(17);
    expect('Department for Levelling Up, Housing and Communities'.startsWith(cut.slice(0, -1))).toBe(true);
    expect(axisLabel('Tenant panels', 16)).toBe('Tenant panels');
  });
});

describe('a policy with no mesh gets a list, not an empty frame', () => {
  const edge = (id: string, from: string, to: string, relation: string) =>
    ({ ...artefact(id, 'edge', relation, 'x', { notes: '' }), fromId: from, toId: to, relation }) as Artefact;
  const mechanism = (id: string, label: string) => artefact(id, 'mechanism', label, 'x', { operator: null, notes: '' });

  // The shape of the Best Start in Life assessment in miniature: two bodies
  // pointing at a lot of machinery, one relationship between them. Total degree
  // makes "Beneficiaries" and "Provider" the two busiest bodies in the paper;
  // neither is connected to anything the grid can draw.
  const all: Artefact[] = [
    actorOf('gov', 'Government'),
    actorOf('la', 'Local authorities'),
    actorOf('kids', 'Beneficiaries'),
    actorOf('prov', 'Provider'),
    ...Array.from({ length: 6 }, (_, i) => mechanism(`m${i}`, `Offer ${i}`)),
    ...Array.from({ length: 6 }, (_, i) => edge(`b${i}`, 'kids', `m${i}`, 'receives_benefit_from')),
    ...Array.from({ length: 5 }, (_, i) => edge(`d${i}`, 'prov', `m${i}`, 'delivers')),
    edge('x1', 'gov', 'la', 'funds'),
  ];
  const net = network(all);
  const grid = adjacency(net);

  it('ranks the axes by the degree the grid can DRAW, not by total degree', () => {
    // Ranking on total degree put the twelve bodies busiest at pointing AT
    // machinery on a live grid and placed none of its 32 body-to-body links.
    // "Beneficiaries" has six relationships and none of them is placeable.
    expect(grid.bodies.slice(0, 2).map((b) => b.id)).toEqual(['gov', 'la']);
    expect(grid.bodies[0].links).toBe(1);
    expect(net.nodes[0].id).toBe('kids');
  });

  it('declares itself illegible rather than drawing an empty frame', () => {
    expect(grid.shown).toBeLessThan(MIN_GRID_EDGES);
    expect(grid.legible).toBe(false);
    expect(grid.placeable).toBe(1);
    expect(grid.total).toBe(12);
  });

  it('lists every body-to-body relationship instead, one row per ordered pair', () => {
    const links = bodyLinks(net);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      fromId: 'gov',
      fromLabel: 'Government',
      toId: 'la',
      toLabel: 'Local authorities',
      relations: ['funds'],
      families: ['money'],
      reciprocated: false,
    });
  });

  it('folds the relations on one pair into one row and marks the return leg', () => {
    const both = network([...all, edge('x2', 'la', 'gov', 'reports_to'), edge('x3', 'gov', 'la', 'commissions')]);
    const links = bodyLinks(both);
    const outward = links.find((l) => l.fromId === 'gov');
    expect(outward?.relations).toEqual(['funds', 'commissions']);
    expect(outward?.ids).toEqual(['x1', 'x3']);
    expect(outward?.reciprocated).toBe(true);
    expect(links.find((l) => l.fromId === 'la')?.reciprocated).toBe(true);
  });

  it('never lists or places a body against itself', () => {
    const selfy = network([...all, edge('x4', 'gov', 'gov', 'funds')]);
    expect(bodyLinks(selfy).some((l) => l.fromId === l.toId)).toBe(false);
    const grid = adjacency(selfy);
    expect(grid.placeable).toBe(1);
    // `shown` must never exceed what the grid says it could hold, and the
    // diagonal is the one cell the picture promises is empty.
    expect(grid.shown).toBe(1);
    expect(grid.rows.every((row, i) => row[i] === null)).toBe(true);
  });

  it('draws the grid as soon as there is a shape to draw', () => {
    const mesh = network([
      ...all,
      ...['la|gov|reports_to', 'prov|la|delivers', 'la|prov|commissions', 'gov|prov|regulates', 'prov|gov|reports_to'].map(
        (spec, i) => {
          const [from, to, relation] = spec.split('|');
          return edge(`y${i}`, from, to, relation);
        },
      ),
    ]);
    const drawn = adjacency(mesh);
    expect(drawn.placeable).toBe(6);
    expect(drawn.shown).toBe(6);
    expect(drawn.legible).toBe(true);
  });
});

describe('every word on the page can be defined', () => {
  it('defines all sixteen things the assessment is made of', () => {
    expect(STRUCTURE_TERMS).toHaveLength(16);
    for (const term of STRUCTURE_TERMS) {
      expect(term.plain, term.key).toBeTruthy();
      expect(term.what.length, term.key).toBeGreaterThan(20);
      expect(term.read.length, term.key).toBeGreaterThan(20);
    }
  });

  it('explains every column header the grids render', () => {
    for (const factor of PLAY_FACTORS) expect(explain(factor)?.plain, factor).toBeTruthy();
    for (const key of ['exposure', 'legality', 'worst', 'actor', 'profile']) {
      expect(explain(key), key).not.toBeNull();
    }
  });

  it('gives every computed measure its arithmetic, and no judgement a formula', () => {
    // A figure with no stated derivation is one a policy professional cannot
    // argue with. A model judgement has no arithmetic, and claiming one would
    // be worse than saying so.
    expect(explain('exposure')?.formula).toMatch(/geometric mean/);
    expect(explain('role')?.formula).toBeTruthy();
    expect(explain('degree')?.formula).toBeTruthy();
    expect(explain('incentive')?.formula).toBeUndefined();
    expect(explain('impact')?.formula).toBeUndefined();
  });

  it('gives every origin a one-word badge, because a cell cannot carry a phrase', () => {
    for (const key of ['extracted_fact', 'structural_inference', 'behavioural_hypothesis', 'model_result', 'normative_judgement', 'prior_assessment', 'external_evidence']) {
      const term = explain(key);
      expect(term?.short, key).toBeTruthy();
      expect(term!.short!.split(' '), key).toHaveLength(1);
    }
  });

  it('puts every term in the key exactly once, and the key holds every term', () => {
    // ONE Map indexes them all, so a duplicated key silently replaces a
    // definition: the relation family `evidence` was overwriting the structure
    // `evidence` (an "evidence link"), and every hover on that structure showed
    // the family's wording instead.
    const listed = KEY_SECTIONS.flatMap((s) => s.terms.map((t) => t.key));
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...explainable()].sort());
  });

  it('keeps a relation family and an artefact kind of the same name apart', () => {
    expect(explain('evidence')?.label).toBe('Evidence link');
    expect(explain(familyTermKey('evidence'))?.label).toBe('Evidence');
  });
});
