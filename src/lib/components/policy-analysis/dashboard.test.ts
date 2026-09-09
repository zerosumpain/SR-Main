// The dashboard, rendered against a full thirteen-stage assessment.
//
// The audit that prompted this work found the previous page shipped without a
// single test driving it, and the two sections the feature exists for — the
// exploitation playbook and cross-policy exposure — had no tab at all, so every
// artefact they produced was unreachable. A type check cannot catch a section
// nobody renders. This can.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { PATTERNS, SCENARIOS, artefact, type Artefact } from '$lib/policy-analysis/contracts';
import { executeStage } from '$lib/policy-analysis/pipeline';
import { ingest } from '$lib/policy-analysis/server/ingest';
import * as view from '$lib/policy-analysis/view';
import { fixtureModel } from '../../../../tests/fixtures/policy-analysis/model';
import Verdict from './Verdict.svelte';
import ExposurePlot from './ExposurePlot.svelte';
import PlayCard from './PlayCard.svelte';
import CheckGrid from './CheckGrid.svelte';
import ActorBoard from './ActorBoard.svelte';
import EvidenceMix from './EvidenceMix.svelte';
import CrossPolicy from './CrossPolicy.svelte';
import ArtefactValue from './ArtefactValue.svelte';

const research = async () => ({ artefacts: [], warnings: ['Synthetic test: external research unavailable.'] });
const inspect = () => {};

/** A complete synthetic assessment: every stage, in order, as the worker runs them. */
async function assessment(): Promise<Artefact[]> {
  const all = (await ingest(readFileSync('tests/fixtures/policy-analysis/policy.txt'), 'policy.txt', 'text/plain')).artefacts;
  const signal = new AbortController().signal;
  for (let stage = 1; stage <= 12; stage++) {
    const result = await executeStage({ stage, title: 'Synthetic policy', jurisdiction: null, policyArea: null, context: null, artefacts: all }, { model: async (...args) => fixtureModel(...args), research, signal });
    all.push(...result.artefacts);
  }
  return all;
}

describe('the assessment renders', () => {
  it('draws every section of a complete run', async () => {
    const all = await assessment();
    const plays = view.plays(all);
    expect(plays.length).toBeGreaterThan(0);

    const verdict = render(Verdict, { props: { headline: view.headline(all), tiles: view.tiles(all, plays), bands: view.bandCounts(plays), status: 'completed', inspect } });
    expect(verdict.body).toContain('The verdict');
    expect(verdict.body).toContain('Ways to beat it');
    expect(verdict.body).toContain('Significant');

    const plot = render(ExposurePlot, { props: { plays, inspect } });
    expect(plot.body).toContain('<svg');
    expect(plot.body).toContain('Easier to do');
    expect(plot.body).toContain('<circle');

    const card = render(PlayCard, { props: { play: plays[0], rank: 1, inspect } });
    expect(card.body).toContain('Stays within the rules as written');
    expect(card.body).toContain('What would close it');
    for (const factor of view.FACTOR_KEYS) expect(card.body).toContain(factor);

    const checks = render(CheckGrid, { props: { checks: view.checks(all), inspect } });
    expect(checks.body).toContain('No evidence either way');

    const actors = render(ActorBoard, { props: { actors: view.actorBoard(all, plays), inspect } });
    expect(actors.body).toContain('Better off if it fails');

    const evidence = render(EvidenceMix, { props: { mix: view.evidenceMix(all), questions: view.of(all, 'research_question'), sources: view.of(all, 'research_source'), inspect } });
    expect(evidence.body).toContain('Lines of enquiry');
    expect(evidence.body).toContain('Insufficient');
  });

  it('says plainly when there is no other policy to compare against', () => {
    const empty = render(CrossPolicy, { props: { found: [], inbound: [], unavailable: true, inspect } });
    expect(empty.body).toContain('only completed assessment on this account');

    const exposure = artefact('s11_main_x', 'cross_policy', 'Two duties, one budget', 'Both policies land on the same council.', {
      pattern: 'cumulative_burden', otherAnalysisId: '11111111-1111-4111-8111-111111111111', otherAnalysisTitle: 'Waste collection reform',
      otherArtefactIds: [], actorId: null, interaction: 'One body, two duties.', consequence: 'One is met in name only.',
      severity: 0.7, evidenceLimits: 'Neither paper states a budget.', action: 'Sequence the commencement dates.',
    }, { refs: ['passage_0001'] });
    const found = render(CrossPolicy, { props: { found: [exposure], inbound: [], unavailable: false, inspect } });
    expect(found.body).toContain('Burden that only bites when stacked');
    expect(found.body).toContain('/policy-analysis/11111111-1111-4111-8111-111111111111');
    expect(found.body).toContain('severity 70');
  });
});

describe('structured fields are readable, and identifiers are left alone', () => {
  it('rewords vocabulary, shows shares as percentages and never mangles an id', () => {
    const out = render(ArtefactValue, {
      props: {
        value: { pattern: 'metric_gaming', importance: 0.65, notes: 'A sentence.', actorId: 's2_main_council', missing: null },
        all: [artefact('s2_main_council', 'actor', 'The Council', 'x', { entityType: 'local_authority', aliases: [], mentions: [], ambiguity: 'x', dates: [], parent: null })],
        inspect,
      },
    });
    expect(out.body).toContain('metric gaming');
    expect(out.body).toContain('65%');
    expect(out.body).toContain('The Council');
    expect(out.body).toContain('Not established');
    // An unresolved identifier is a string with underscores, not prose.
    const raw = render(ArtefactValue, { props: { value: { actorId: 's10_003_exploit' }, all: [], inspect } });
    expect(raw.body).toContain('s10_003_exploit');
    expect(raw.body).not.toContain('s10 003 exploit');
  });
});

describe('the derivations rank what matters first', () => {
  it('orders plays, checks and actors by consequence rather than arrival', async () => {
    const all = await assessment();
    const plays = view.plays(all);
    expect([...plays].sort((a, b) => b.exposure - a.exposure).map((p) => p.artefact.id)).toEqual(plays.map((p) => p.artefact.id));
    const results = view.checks(all).map((c) => String(c.data.result));
    const rank = view.TEST_RESULTS.map((r) => r.key as string);
    expect(results.map((r) => rank.indexOf(r))).toEqual([...results.map((r) => rank.indexOf(r))].sort((a, b) => a - b));
    expect(view.of(all, 'model')).toHaveLength(PATTERNS.length);
    expect(view.of(all, 'scenario')).toHaveLength(SCENARIOS.length);
  });
});
