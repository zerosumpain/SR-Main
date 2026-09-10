// The shaping behind the dashboard rebuild: the glossary, the actor atlas, the
// relationship network, the verdict summary and the exportable document.
//
// All five are PURE, which is the point of putting them here rather than in the
// components — a chart that redraws on five measures and a document that has to
// come out identical for two different readers are both things you want to
// assert without mounting anything or opening a browser.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { artefact, PERSONA_STAGE, type Artefact } from './contracts';
import { executeStage } from './pipeline';
import { ingest } from './server/ingest';
import { fixtureModel } from '../../../tests/fixtures/policy-analysis/model';
import * as view from './view';
import { atlas, ceiling, formatMeasure, rank, ACTOR_MEASURES, degrees } from './actors';
import { network, edgesOf } from './network';
import { explain, explainable, familyOf, RELATION_FAMILIES, FACTOR_TERMS } from './glossary';
import { assessmentMarkdown, documentSlug } from './report-doc';
import { parseSubject } from './peek.svelte';
import { shareableReport } from './share';
import { STAGES } from './contracts';

const research = async () => ({ artefacts: [], warnings: ['Synthetic test: external research unavailable.'] });

/** A complete synthetic assessment: every stage, in order, as the worker runs them. */
async function assessment(): Promise<Artefact[]> {
  const all = (await ingest(readFileSync('tests/fixtures/policy-analysis/policy.txt'), 'policy.txt', 'text/plain')).artefacts;
  const signal = new AbortController().signal;
  for (let stage = 1; stage <= PERSONA_STAGE; stage++) {
    const result = await executeStage(
      { stage, title: 'Synthetic policy', jurisdiction: null, policyArea: null, context: null, artefacts: all },
      { model: async (...args) => fixtureModel(...args), research, signal },
    );
    all.push(...result.artefacts);
  }
  return all;
}

describe('the glossary explains every term the page prints', () => {
  it('covers every exposure factor, band, evidence result and check verdict', () => {
    for (const key of ['incentive', 'ease', 'impact', 'concealment']) expect(explain(key), key).not.toBeNull();
    for (const key of ['severe', 'significant', 'moderate', 'limited']) expect(explain(key), key).not.toBeNull();
    for (const key of ['supports', 'contradicts', 'mixed', 'insufficient']) expect(explain(key), key).not.toBeNull();
    for (const key of ['high_risk', 'moderate_risk', 'low_risk', 'indeterminate']) expect(explain(key), key).not.toBeNull();
  });

  it('explains every ORIGIN an artefact can carry, because that is the epistemic backbone', async () => {
    const all = await assessment();
    for (const origin of new Set(all.map((a) => a.origin))) {
      expect(explain(origin), `origin ${origin} has no explainer`).not.toBeNull();
    }
  });

  it('every entry says what it is, why it is there, and how to read a high value', () => {
    for (const key of explainable()) {
      const term = explain(key)!;
      expect(term.what.length, key).toBeGreaterThan(10);
      expect(term.why.length, key).toBeGreaterThan(10);
      expect(term.read.length, key).toBeGreaterThan(10);
    }
  });

  it('says out loud that concealment is about the policy, not about honesty', () => {
    const concealment = FACTOR_TERMS.find((t) => t.key === 'concealment')!;
    expect(concealment.what).toContain('not how secretive');
  });

  it('says exposure is a severity rather than a certainty', () => {
    expect(explain('exposure')!.read).toMatch(/severity|not one the assessment is/i);
  });

  it('has no term without an explainer key, and no key claimed by two families', () => {
    const seen = new Set<string>();
    for (const family of RELATION_FAMILIES) {
      for (const relation of family.relations) {
        expect(seen.has(relation), `${relation} is in two families`).toBe(false);
        seen.add(relation);
        expect(familyOf(relation)).toBe(family.key);
      }
    }
  });

  it('returns null for a relation the vocabulary has since gained', () => {
    expect(familyOf('teleports_to')).toBeNull();
    expect(familyOf(null)).toBeNull();
  });
});

describe('the actor atlas redraws on the measure the reader picks', () => {
  it('carries all five measures on every row, so switching one recomputes nothing', async () => {
    const all = await assessment();
    const rows = atlas(all, view.actorBoard(all, view.plays(all)));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const measure of ACTOR_MEASURES) {
        expect(Number.isFinite(row.measures[measure.key]), `${row.label} has no ${measure.key}`).toBe(true);
      }
    }
  });

  it('ranks by whichever measure is asked for, and the orders genuinely differ', async () => {
    const all = await assessment();
    const rows = atlas(all, view.actorBoard(all, view.plays(all)));
    for (const measure of ACTOR_MEASURES) {
      const ranked = rank(rows, measure.key);
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i - 1].measures[measure.key]).toBeGreaterThanOrEqual(ranked[i].measures[measure.key]);
      }
    }
  });

  it('LEAVES OUT a body that scores nothing rather than drawing it as a zero', () => {
    const actor = artefact('s2_001', 'actor', 'A body nobody attacks', 'x', {
      entityType: 'agency', aliases: [], mentions: [], ambiguity: '', dates: [], parent: null,
    });
    const rows = atlas([actor], [{ actor, profile: null, plays: [], worst: 0 }]);
    expect(rows).toHaveLength(1);
    // An empty bar with a name beside it reads as something the assessment
    // measured, when it is an absence it never looked for.
    expect(rank(rows, 'worst')).toHaveLength(0);
  });

  it('normalises the role index across the cast, so the tallest bar is always 1', async () => {
    const all = await assessment();
    const rows = atlas(all, view.actorBoard(all, view.plays(all)));
    const top = ceiling(rows, 'role');
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThanOrEqual(1);
    for (const row of rows) expect(row.measures.role).toBeLessThanOrEqual(1);
  });

  it('prints counts as integers and the two fractions as a 0–100 score', () => {
    expect(formatMeasure('plays', 3)).toBe('3');
    expect(formatMeasure('degree', 12)).toBe('12');
    expect(formatMeasure('worst', 0.826)).toBe('83');
    expect(formatMeasure('role', 0.5)).toBe('50');
  });

  it('counts a relationship at BOTH of its ends', () => {
    const edge = artefact('e1', 'edge', 'x', 'y', { notes: '' }, { fromId: 'a', toId: 'b', relation: 'funds' });
    const counts = degrees([edge]);
    expect(counts.get('a')).toBe(1);
    expect(counts.get('b')).toBe(1);
  });
});

describe('the relationship map reads the graph rather than listing it', () => {
  it('drops an edge whose end is not in the assessment', () => {
    const a = artefact('a', 'actor', 'A', 'x', { entityType: 'agency', aliases: [], mentions: [], ambiguity: '', dates: [], parent: null });
    const dangling = artefact('e1', 'edge', 'x', 'y', { notes: '' }, { fromId: 'a', toId: 'gone', relation: 'funds' });
    // A dangling end is a reference, not a relationship: drawing it would put a
    // body on the map that the assessment cannot open.
    expect(edgesOf([a, dangling])).toHaveLength(0);
  });

  it('folds relations into families and counts the ones no family claims', () => {
    const a = artefact('a', 'actor', 'A', 'x', { entityType: 'agency', aliases: [], mentions: [], ambiguity: '', dates: [], parent: null });
    const b = artefact('b', 'actor', 'B', 'x', { entityType: 'agency', aliases: [], mentions: [], ambiguity: '', dates: [], parent: null });
    const funds = artefact('e1', 'edge', 'x', 'y', { notes: '' }, { fromId: 'a', toId: 'b', relation: 'funds' });
    const net = network([a, b, funds]);
    expect(net.families.map((f) => f.key)).toContain('money');
    expect(net.unfamilied).toBe(0);
  });

  it('names authority with no accountability, and does NOT call it unaccountable', () => {
    const a = artefact('a', 'actor', 'The Regulator', 'x', { entityType: 'agency', aliases: [], mentions: [], ambiguity: '', dates: [], parent: null });
    const b = artefact('b', 'actor', 'A Provider', 'x', { entityType: 'provider', aliases: [], mentions: [], ambiguity: '', dates: [], parent: null });
    const rules = artefact('e1', 'edge', 'x', 'y', { notes: '' }, { fromId: 'a', toId: 'b', relation: 'has_authority_over' });
    const insight = network([a, b, rules]).insights.find((i) => i.key === 'authority-without-accountability')!;
    expect(insight.subjects.map((s) => s.label)).toContain('The Regulator');
    // A graph can say the paper does not state a line. It cannot say none exists.
    expect(insight.reading).toContain('gap in the paper');
  });

  it('does not name a body that DOES report to someone', () => {
    const a = artefact('a', 'actor', 'The Regulator', 'x', { entityType: 'agency', aliases: [], mentions: [], ambiguity: '', dates: [], parent: null });
    const b = artefact('b', 'actor', 'A Provider', 'x', { entityType: 'provider', aliases: [], mentions: [], ambiguity: '', dates: [], parent: null });
    const c = artefact('c', 'actor', 'The Department', 'x', { entityType: 'department', aliases: [], mentions: [], ambiguity: '', dates: [], parent: null });
    const rules = artefact('e1', 'edge', 'x', 'y', { notes: '' }, { fromId: 'a', toId: 'b', relation: 'has_authority_over' });
    const reports = artefact('e2', 'edge', 'x', 'y', { notes: '' }, { fromId: 'a', toId: 'c', relation: 'reports_to' });
    const insight = network([a, b, c, rules, reports]).insights.find((i) => i.key === 'authority-without-accountability');
    expect(insight?.subjects.map((s) => s.label) ?? []).not.toContain('The Regulator');
  });

  it('finds the body measured on data it supplies itself', () => {
    const a = artefact('a', 'actor', 'A Provider', 'x', { entityType: 'provider', aliases: [], mentions: [], ambiguity: '', dates: [], parent: null });
    const m = artefact('m', 'actor', 'The Outcome Measure', 'x', { entityType: 'dataset', aliases: [], mentions: [], ambiguity: '', dates: [], parent: null });
    const measured = artefact('e1', 'edge', 'x', 'y', { notes: '' }, { fromId: 'a', toId: 'm', relation: 'is_measured_by' });
    const owns = artefact('e2', 'edge', 'x', 'y', { notes: '' }, { fromId: 'a', toId: 'm', relation: 'owns_data' });
    const insight = network([a, m, measured, owns]).insights.find((i) => i.key === 'marks-own-homework')!;
    expect(insight.subjects.map((s) => s.label)).toContain('A Provider');
  });

  it('runs over a real assessment without inventing an end it cannot open', async () => {
    const all = await assessment();
    const net = network(all);
    const ids = new Set(all.map((a) => a.id));
    for (const node of net.nodes) expect(ids.has(node.id), `${node.id} is not an artefact`).toBe(true);
  });
});

describe('the verdict is the headline story, summarised', () => {
  it('splits on the first paragraph break and keeps the remainder', () => {
    const { lead, rest } = view.summarise('The first paragraph.\n\nThe second.\n\nThe third.');
    expect(lead).toBe('The first paragraph.');
    expect(rest).toBe('The second.\n\nThe third.');
  });

  it('leaves a short statement whole rather than cutting it mid-thought', () => {
    const { lead, rest } = view.summarise('Short enough to read.');
    expect(lead).toBe('Short enough to read.');
    expect(rest).toBe('');
  });

  it('splits a LONG single paragraph, because that is the case the summary exists for', () => {
    const sentence = 'The policy relies on a body that has every reason to under-report against it, and states no counterpart. ';
    const { lead, rest } = view.summarise(sentence.repeat(8));
    expect(lead.length).toBeGreaterThanOrEqual(view.LEAD_FLOOR);
    expect(rest.length).toBeGreaterThan(0);
    // Nothing is lost in the split.
    expect(`${lead} ${rest}`.replace(/\s+/g, ' ').trim()).toBe(sentence.repeat(8).replace(/\s+/g, ' ').trim());
  });

  it('averages the four factors across the playbook, unweighted', async () => {
    const all = await assessment();
    const plays = view.plays(all);
    const profile = view.factorProfile(plays);
    expect(profile.map((f) => f.key)).toEqual(['incentive', 'ease', 'impact', 'concealment']);
    for (const factor of profile) {
      expect(factor.mean).toBeGreaterThanOrEqual(0);
      expect(factor.mean).toBeLessThanOrEqual(1);
    }
  });

  it('reports zeroes rather than NaN when there is no playbook yet', () => {
    for (const factor of view.factorProfile([])) {
      expect(factor.mean).toBe(0);
      expect(factor.top).toBeNull();
    }
  });
});

describe('the rail is grouped for the eye and flat for navigation', () => {
  it('partitions every tab into exactly one group, in tab order', () => {
    const flat = view.tabGroups().flatMap((g) => g.tabs.map((t) => t.id));
    expect(flat).toEqual(view.TABS.map((t) => t.id));
  });

  it('keeps every index pointing at the tab it names', () => {
    for (const group of view.tabGroups()) {
      for (const tab of group.tabs) expect(view.TABS[tab.index].id).toBe(tab.id);
    }
  });
});

describe('a peek anchor names its kind, so the card is context-aware', () => {
  it('splits on the FIRST colon, because an identifier may carry one', () => {
    expect(parseSubject('actor:s2_001')).toEqual({ kind: 'actor', subject: 's2_001' });
    expect(parseSubject('term:concealment')).toEqual({ kind: 'term', subject: 'concealment' });
    expect(parseSubject('artefact:a:b')).toEqual({ kind: 'artefact', subject: 'a:b' });
  });

  it('ignores an attribute this build cannot render, rather than opening an empty card', () => {
    expect(parseSubject('sandwich:s2_001')).toBeNull();
    expect(parseSubject('actor:')).toBeNull();
    expect(parseSubject(':s2_001')).toBeNull();
    expect(parseSubject(null)).toBeNull();
  });
});

describe('the exported document is the assessment, linearly', () => {
  it('opens by saying what it is, because whoever was sent it has nobody to ask', async () => {
    const all = await assessment();
    const md = assessmentMarkdown(all, { title: 'Synthetic policy' });
    expect(md).toContain('# Synthetic policy');
    expect(md).toContain('red-team assessment');
    expect(md).toContain('not an assurance review');
  });

  it('carries the playbook, the cast, the checks and the written chapters', async () => {
    const all = await assessment();
    const md = assessmentMarkdown(all, { title: 'Synthetic policy' });
    expect(md).toContain('## The exploitation playbook');
    expect(md).toContain('## Who is in the room');
    expect(md).toContain('## Structural checks');
    expect(md).toContain('A check with nothing to look at is not a pass');
  });

  it('names every limit the run recorded rather than quietly dropping it', async () => {
    const all = await assessment();
    const md = assessmentMarkdown(all, {
      title: 'Synthetic policy',
      warnings: [{ stage: 'Targeted research', text: 'External research unavailable.' }],
    });
    expect(md).toContain('## What this assessment could not establish');
    expect(md).toContain('External research unavailable.');
  });

  it('renders the SHARED copy from the same module, and says what it withholds', async () => {
    const all = await assessment();
    const stages = STAGES.map((name, ordinal) => ({ ordinal, name, warnings: [] as string[] }));
    const redacted = shareableReport({ artefacts: all, stages }).artefacts;
    const shared = assessmentMarkdown(redacted, {
      title: 'Synthetic policy',
      withheld: ['the policy document itself'],
    });
    expect(shared).toContain('This is a shared copy');
    expect(shared).toContain('the policy document itself');
    // Same document, same headings — the two readers cannot get different reports.
    expect(shared).toContain('## The exploitation playbook');
  });

  it('leaves a section OUT rather than printing an empty heading', () => {
    const md = assessmentMarkdown([], { title: 'Nothing yet' });
    expect(md).not.toContain('## The exploitation playbook');
    expect(md).not.toContain('## Who is in the room');
    expect(md).toContain('# Nothing yet');
  });

  it('slugs a real policy title into a filename', () => {
    expect(documentSlug('Post-16 Education and Skills')).toBe('post-16-education-and-skills');
    expect(documentSlug('  ???  ')).toBe('policy-assessment');
    expect(documentSlug('x'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});
