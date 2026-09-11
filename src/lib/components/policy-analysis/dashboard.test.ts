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
import { PATTERNS, PERSONA_STAGE, REPORT_SECTIONS, SCENARIOS, artefact, type Artefact } from '$lib/policy-analysis/contracts';
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
import ReportActs from './ReportActs.svelte';
import InterplayMap from './InterplayMap.svelte';
import ScenarioFlow from './ScenarioFlow.svelte';
import StressLab from './StressLab.svelte';
import AssessmentBody from './AssessmentBody.svelte';
import { shareableReport } from '$lib/policy-analysis/share';
import { STAGES } from '$lib/policy-analysis/contracts';
import { leverage } from '$lib/policy-analysis/stress';

const research = async () => ({ artefacts: [], warnings: ['Synthetic test: external research unavailable.'] });
const inspect = () => {};

/** A complete synthetic assessment: every stage, in order, as the worker runs them. */
async function assessment(): Promise<Artefact[]> {
  const all = (await ingest(readFileSync('tests/fixtures/policy-analysis/policy.txt'), 'policy.txt', 'text/plain')).artefacts;
  const signal = new AbortController().signal;
  for (let stage = 1; stage <= PERSONA_STAGE; stage++) {
    const result = await executeStage({ stage, title: 'Synthetic policy', jurisdiction: null, policyArea: null, context: null, artefacts: all }, { model: async (...args) => fixtureModel(...args), research, signal });
    all.push(...result.artefacts);
  }
  return all;
}

describe('what the run cost', () => {
  const call = (usage: unknown[] | null, model = 'codex/gpt-5.6-luna') => ({ model, usage });

  it('sums the array on each call, because a repair round appends rather than replaces', () => {
    const cost = view.runCost([
      call([{ model: 'codex/gpt-5.6-luna', tokensInput: 40_000, tokensOutput: 1_500, reasoningTokens: 300, cacheReadTokens: 1_000, costUsd: null },
            { model: 'codex/gpt-5.6-luna', tokensInput: 42_000, tokensOutput: 900, reasoningTokens: 100, cacheReadTokens: 0, costUsd: null }]),
      call([{ model: 'codex/gpt-5.6-luna', tokensInput: 10_000, tokensOutput: 500, reasoningTokens: 0, cacheReadTokens: 0, costUsd: null }]),
    ]);
    expect(cost.input).toBe(92_000);
    expect(cost.output).toBe(2_900);
    expect(cost.reasoning).toBe(400);
    expect(cost.cached).toBe(1_000);
    expect(cost.total).toBe(94_900);
    expect(cost.calls).toBe(2);
  });

  it('reports no cash rather than zero when everything ran on subscription quota', () => {
    // Codex prices as null, never 0. "£0.00" reads as free money; the truth is
    // that quota was spent and no bill exists.
    const cost = view.runCost([call([{ model: 'codex/gpt-5.6-luna', tokensInput: 10, tokensOutput: 1, costUsd: null }])]);
    expect(cost.cash).toBeNull();
  });

  it('adds up a priced run', () => {
    const cost = view.runCost([
      call([{ model: 'x/y', tokensInput: 10, tokensOutput: 1, costUsd: 0.25 }], 'x/y'),
      call([{ model: 'x/y', tokensInput: 10, tokensOutput: 1, costUsd: 0.5 }], 'x/y'),
    ]);
    expect(cost.cash).toBeCloseTo(0.75);
  });

  it('splits by model, heaviest first, and ignores a call that reported nothing', () => {
    const cost = view.runCost([
      call([{ model: 'codex/gpt-5.6-luna', tokensInput: 1_000, tokensOutput: 10 }]),
      call([{ model: 'codex/gpt-6-astra', tokensInput: 50_000, tokensOutput: 900 }], 'codex/gpt-6-astra'),
      call(null),
      { model: 'codex/gpt-6-astra' },
    ]);
    expect(cost.calls).toBe(2);
    expect(cost.models.map((m) => m.model)).toEqual(['codex/gpt-6-astra', 'codex/gpt-5.6-luna']);
  });

  it('falls back to the call’s own model when a usage row does not name one', () => {
    const cost = view.runCost([call([{ tokensInput: 5, tokensOutput: 1 }], 'codex/gpt-5.5')]);
    expect(cost.models[0].model).toBe('codex/gpt-5.5');
  });

  it('is zero, not a crash, before anything has run', () => {
    const cost = view.runCost([]);
    expect(cost).toMatchObject({ input: 0, output: 0, total: 0, cash: null, calls: 0, models: [] });
  });
});

describe('the written assessment reads as acts', () => {
  it('places every report section in exactly one act', () => {
    // A section added to the contract and not to an act would silently stop
    // appearing on the page — the failure this whole file exists to catch.
    const claimed = view.REPORT_ACTS.flatMap((a) => [...a.sections]);
    expect([...claimed].sort()).toEqual([...REPORT_SECTIONS].sort());
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it('draws every act, every chapter and the redesign options, with all panels in the DOM', async () => {
    const all = await assessment();
    const acts = view.reportActs(all);
    expect(acts.length).toBeGreaterThan(1);
    expect(view.unplacedSections(all)).toEqual([]);

    const html = render(ReportActs, { props: { acts, recommendations: view.of(all, 'recommendation'), inspect } }).body;
    // Tabs are real tabs, and the panels are all present so that find-in-page
    // and the print stylesheet still reach the acts nobody clicked.
    // A CONTENTS RAIL, not a tab strip. The acts used to open a second tab
    // system inside the report tab; now they are one continuous narrative and
    // this only jumps between them.
    expect(html).toContain('class="contents');
    expect(html).not.toContain('role="tablist"');
    for (const act of acts) {
      expect(html).toContain(act.title);
      expect(html).toContain(act.strap);
      expect(html).toContain(`id="report-panel-${act.key}"`);
      for (const chapter of act.chapters) {
        for (const item of chapter.items) expect(html).toContain(item.statement);
      }
    }
    // Exactly one panel is open on first paint.
    // Every act is present AND visible: the whole point of the rail is that the
    // written assessment reads in order without anything hidden behind a control.
    expect([...html.matchAll(/role="tabpanel"/g)]).toHaveLength(0);
    expect([...html.matchAll(/class="panel[^"]*\boff\b/g)]).toHaveLength(0);
  });

  it('hides no act at all — the report is one narrative now', async () => {
    const all = await assessment();
    const html = render(ReportActs, { props: { acts: view.reportActs(all), recommendations: view.of(all, 'recommendation'), inspect } }).body;
    expect(html).not.toMatch(/class="panel[^"]*\boff\b/);
    expect(html).not.toMatch(/<section[^>]*\shidden/);
  });

  it('hides an inactive TAB by class, never the hidden attribute', async () => {
    const all = await assessment();
    const html = render(AssessmentBody, { props: { artefacts: all, status: 'completed' } }).body;
    // Scoped to the workspace panels: the report's five acts are nested inside
    // this component and carry the same class for the same reason.
    // One tab visible, the rest off by CLASS — find-in-page still reaches them
    // and `@media print` unhides all of them, which `hidden` would defeat.
    const panels = [...html.matchAll(/class="[^"]*\bab-panel\b[^"]*"/g)].length;
    const off = [...html.matchAll(/class="[^"]*\bab-panel\b[^"]*\boff\b/g)].length;
    expect(panels).toBeGreaterThan(1);
    expect(off).toBe(panels - 1);
    expect(html).not.toMatch(/role="tabpanel"[^>]*\shidden/);
    // And each one is named on paper, where the tabs are not there to name them.
    for (const name of ['The verdict', 'The threat', 'The cast', 'The ground it stands on', 'The assessment']) {
      expect(html).toMatch(new RegExp(`<h2 class="ab-print-title[^"]*">${name}</h2>`));
    }
  });

  it('puts the redesign options in the act that asks what to do', async () => {
    const all = await assessment();
    const recommendations = view.of(all, 'recommendation');
    expect(recommendations.length).toBeGreaterThan(0);
    const acts = view.reportActs(all);
    const html = render(ReportActs, { props: { acts, recommendations, inspect } }).body;
    const response = html.indexOf('id="report-panel-response"');
    expect(response).toBeGreaterThan(-1);
    // They used to sit above the verdict; they belong with the answer.
    expect(html.indexOf('Redesign options')).toBeGreaterThan(response);
  });
});

describe('the assessment renders', () => {
  it('draws every section of a complete run', async () => {
    const all = await assessment();
    const plays = view.plays(all);
    expect(plays.length).toBeGreaterThan(0);

    const verdict = render(Verdict, { props: { headline: view.headline(all), tiles: view.tiles(all, plays), bands: view.bandCounts(plays), plays, status: 'completed', onopen: inspect } });
    expect(verdict.body).toContain('The verdict');
    expect(verdict.body).toContain('Ways to beat it');
    expect(verdict.body).toContain('Significant');

    const plot = render(ExposurePlot, { props: { plays, inspect } });
    expect(plot.body).toContain('<svg');
    expect(plot.body).toContain('Easier to do');
    expect(plot.body).toContain('<circle');

    const card = render(PlayCard, { props: { play: plays[0], rank: 1, onopen: inspect } });
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

describe('the interplay map joins the actors to what they attack', () => {
  it('draws one arc per play per target, and ranks a target by the pressure on it', async () => {
    const all = await assessment();
    const map = view.interplay(all, view.plays(all));
    expect(map.links.length).toBeGreaterThan(0);
    // Every arc is a play the assessment actually made, aimed at something it
    // actually named — no arc is invented to fill the picture.
    for (const link of map.links) {
      expect(all.some((a) => a.id === link.playId && a.kind === 'exploit')).toBe(true);
      expect(map.actors.some((actorRow) => actorRow.actor.id === link.actorId)).toBe(true);
    }
    const pressures = map.targets.map((t) => t.pressure);
    expect(pressures).toEqual([...pressures].sort((a, b) => b - a));
  });

  it('counts the tail rather than drawing it', () => {
    const actor = artefact('s2_0', 'actor', 'A body', 'x', { entityType: 'department', aliases: [], mentions: [], ambiguity: '', dates: [], parent: null }, {});
    const targets = Array.from({ length: view.INTERPLAY_TARGETS + 4 }, (_, i) =>
      artefact(`mech_${i}`, 'mechanism', `Mechanism ${i}`, 'x', { intervention: '', implementation: '', notes: '' }, {}));
    const plays = targets.map((t, i) =>
      artefact(`x_${i}`, 'exploit', `Play ${i}`, 'x', { actorId: 's2_0', targets: [t.id], preconditions: [], exposure: 0.5, band: 'moderate', legality: 'compliant', motivation: '', play: '', payoff: '', costToPolicy: '', incentive: 0.5, ease: 0.5, impact: 0.5, concealment: 0.5, earlyWarning: '', counter: '', precedent: '' }, {}));
    const all = [actor, ...targets, ...plays];
    const map = view.interplay(all, view.plays(all));
    expect(map.targets).toHaveLength(view.INTERPLAY_TARGETS);
    expect(map.hidden).toBe(4);
  });

  it('keeps a knob inside its row however far an actor reaches', () => {
    // `5 + reach` looked right on a two-actor fixture. On a live assessment one
    // actor reached twelve parts of the policy, which would have drawn a
    // 34-unit knob into a 34-unit row and turned the column into a solid bar.
    const actors = Array.from({ length: 6 }, (_, i) =>
      artefact(`s2_${i}`, 'actor', `Body ${i}`, 'x', { entityType: 'department', aliases: [], mentions: [], ambiguity: '', dates: [], parent: null }, {}));
    const targets = Array.from({ length: 12 }, (_, i) =>
      artefact(`mech_${i}`, 'mechanism', `Mechanism ${i}`, 'x', { intervention: '', implementation: '', notes: '' }, {}));
    // One actor aimed at everything, the rest at one target each.
    const plays = [
      ...targets.map((t, i) => artefact(`x_wide_${i}`, 'exploit', `Wide play ${i}`, 'x', { actorId: 's2_0', targets: [t.id], preconditions: [], exposure: 0.6, band: 'significant', legality: 'compliant', motivation: '', play: '', payoff: '', costToPolicy: '', incentive: 0.6, ease: 0.6, impact: 0.6, concealment: 0.6, earlyWarning: '', counter: '', precedent: '' }, {})),
      ...actors.slice(1).map((a, i) => artefact(`x_one_${i}`, 'exploit', `Narrow play ${i}`, 'x', { actorId: a.id, targets: [targets[i].id], preconditions: [], exposure: 0.4, band: 'moderate', legality: 'compliant', motivation: '', play: '', payoff: '', costToPolicy: '', incentive: 0.4, ease: 0.4, impact: 0.4, concealment: 0.4, earlyWarning: '', counter: '', precedent: '' }, {})),
    ];
    const all = [...actors, ...targets, ...plays];
    const html = render(InterplayMap, { props: { map: view.interplay(all, view.plays(all)), inspect } }).body;
    const radii = [...html.matchAll(/<circle[^>]*\sr="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(radii.length).toBeGreaterThan(0);
    // Rows are 34 units apart, so a diameter of 34 is where knobs touch.
    expect(Math.max(...radii)).toBeLessThanOrEqual(14);
  });

  it('renders both columns and the table beneath them', async () => {
    const all = await assessment();
    const html = render(InterplayMap, { props: { map: view.interplay(all, view.plays(all)), inspect } }).body;
    expect(html).toContain('Who moves');
    expect(html).toContain('What it defeats');
    expect(html).toContain('The same map as a table');
  });
});

describe('a scenario reads as a sequence, not a paragraph', () => {
  it('breaks it into beats in the order the behaviour happens', async () => {
    const all = await assessment();
    const scenario = view.of(all, 'scenario')[0];
    const beats = view.scenarioBeats(scenario, all);
    const keys = beats.map((b) => b.key);
    expect(keys[0]).toBe('condition');
    expect(keys).toContain('detect');
    expect(keys.indexOf('condition')).toBeLessThan(keys.indexOf('detect'));
    // The first mover is named from the resolved actor, not from an id.
    expect(beats.find((b) => b.key === 'first')?.label).not.toContain('s2_');
  });

  it('leaves out a beat the scenario did not record', () => {
    const bare = artefact('s9_0_x', 'scenario', 'A bare scenario', 'x', { scenario: 'minimum_compliance', changedConditions: 'Something changes.', firstActor: null, strategy: '', downstreamEffects: [], affectedOutcomes: [], detectability: '', correction: '', weaknesses: [], assumptions: [], sensitivity: [] }, {});
    expect(view.scenarioBeats(bare, [bare]).map((b) => b.key)).toEqual(['condition']);
  });

  it('steps through one scenario at a time with the others still reachable', async () => {
    const all = await assessment();
    const html = render(ScenarioFlow, { props: { scenarios: view.of(all, 'scenario'), artefacts: all, onopen: inspect } }).body;
    expect(html).toContain('Beat 1 of');
    // The flow draws every beat as a numbered stage, not just the one on screen:
    // the shape of the sequence is the finding.
    expect(html).toContain('The condition changes');
    expect(html).toContain('Would anyone see it?');
    for (const scenario of SCENARIOS) expect(html).toContain(scenario.replaceAll('_', ' '));
  });
});

describe('the stress test recomputes rather than re-asks', () => {
  it('offers only cited assumptions, and reports both directions', async () => {
    const all = await assessment();
    const html = render(StressLab, { props: { artefacts: all, onopen: inspect } }).body;
    expect(html).toContain('Suppose these turn out to be wrong');
    expect(html).toContain('The assessment as written');
    // The consequence strip carries BOTH directions before a lever is pulled, so
    // a reader can see they are opposites without having to discover it: the
    // conclusions that would fall, and the plays that would come off the table.
    expect(html).toContain('Conclusions lose footing');
    expect(html).toContain('Plays disarmed');
    // The levers are the assumptions something rests on — never every assumption.
    const offered = leverage(all).length;
    expect(offered).toBeGreaterThan(0);
    expect(offered).toBeLessThanOrEqual(view.of(all, 'assumption').length);
  });
});

describe('an actor the reader has met before says so', () => {
  it('links the card to the dossier and counts the sightings', async () => {
    const all = await assessment();
    const actors = view.actorBoard(all, view.plays(all));
    const html = render(ActorBoard, {
      props: { actors, personas: [{ actorId: actors[0].actor.id, personaId: '11111111-1111-4111-8111-111111111111', name: actors[0].actor.label, sightings: 4 }], inspect },
    }).body;
    expect(html).toContain('/policy-analysis/personas/11111111-1111-4111-8111-111111111111');
    expect(html).toContain('seen in 4 assessments');
  });

  it('says nothing at all when the body is new to the library', async () => {
    const all = await assessment();
    const html = render(ActorBoard, { props: { actors: view.actorBoard(all, view.plays(all)), personas: [], inspect } }).body;
    expect(html).not.toContain('In your library');
  });
});

describe('the persona library is written by the last stage', () => {
  it('produces one link per profiled actor, traceable to the actor and its profile', async () => {
    const all = await assessment();
    const links = view.of(all, 'persona_link');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(all.some((a) => a.id === link.data.actorId && a.kind === 'actor')).toBe(true);
      expect(link.refs.length).toBeGreaterThan(0);
    }
  });
});

describe('the shared copy is the same report, minus what it may not carry', () => {
  const stages = STAGES.map((name, ordinal) => ({ ordinal, name, warnings: [] as string[] }));

  it('renders every workspace and every section a signed-in reader gets', async () => {
    const all = await assessment();
    const owner = render(AssessmentBody, { props: { artefacts: all, status: 'completed', cross: { inbound: [], unavailable: false } } }).body;
    const shared = render(AssessmentBody, { props: { artefacts: shareableReport({ artefacts: all, stages }).artefacts, status: 'completed' } }).body;
    // Both are the same component, which is the point of extracting it: the two
    // views cannot drift into different reports. The only structural difference
    // is the cross-policy chapter, which a shared copy may not carry.
    // The panels ARE the section anchors now — the workspace grouping that used
    // to sit between a reader and a section is gone.
    for (const id of ['id="verdict"', 'id="playbook"', 'id="actors"', 'id="personas"', 'id="stress"', 'id="report"']) {
      expect(owner).toContain(id);
      expect(shared).toContain(id);
    }
    // Matched on the KICKER rather than the headline: a `DashHead` title is an
    // array of lines joined by a <br>, because where a two-word display headline
    // folds is a typographic decision. The kicker is one string and is the thing
    // that tells a reader what the section is for.
    for (const kicker of ['How the paper can be beaten', 'Who is coming for what', 'What if we are wrong?', 'Where the paper is thin', 'The written assessment']) {
      expect(shared).toContain(kicker);
    }
    // Same reason as the kickers above — the cross-policy headline is two lines.
    expect(owner).toContain('Across policies');
    expect(shared).not.toContain('Across policies');
  });

  it('carries no run log, and no persona chip pointing into a private library', async () => {
    const all = await assessment();
    const shared = render(AssessmentBody, { props: { artefacts: shareableReport({ artefacts: all, stages }).artefacts, status: 'completed' } }).body;
    expect(shared).not.toContain('Run log and provenance');
    expect(shared).not.toContain('model calls across');
    expect(shared).not.toContain('/policy-analysis/personas/');
    expect(shared).not.toContain('Delete this assessment');
  });
});


describe('one tab row, and every old deep link still lands', () => {
  /**
   * The report used to be four workspaces, each holding two or three sections,
   * with the written assessment opening a SECOND tab strip inside the fourth.
   * Two navigation systems for the same content. Flattening them is only safe if
   * every anchor that used to be reachable still is — a deep link into a section
   * that no tab claims lands nowhere, silently.
   */
  it('claims every section the report used to group into workspaces', () => {
    for (const section of ['verdict', 'playbook', 'interplay', 'actors', 'network', 'stress', 'checks', 'scenarios', 'evidence', 'cross', 'report', 'provenance']) {
      expect(view.isSectionHash(section), `${section} is no longer reachable`).toBe(true);
    }
  });

  it('has unique ids and no nesting left to describe', () => {
    const ids = view.TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('personas');
  });

  it('does not treat an artefact id as a tab', () => {
    expect(view.isSectionHash('s10_000_exploit_001')).toBe(false);
  });
});

describe('a persona is one body, however many records the library holds', () => {
  const actorOf = (id: string, label: string) => artefact(id, 'actor', label, 'x', { entityType: 'agency', aliases: [], mentions: [], ambiguity: '', dates: [], parent: null });

  it('groups records that share a name, and names the split', () => {
    const board = [
      { actor: actorOf('s2_001', 'Education Endowment Foundation'), profile: null, plays: [], worst: 0.4 },
      { actor: actorOf('s2_002', 'Education Endowment Foundation'), profile: null, plays: [], worst: 0.8 },
      { actor: actorOf('s2_003', 'Ofsted'), profile: null, plays: [], worst: 0.2 },
    ];
    const groups = view.personaBoard(board, [
      { actorId: 's2_001', personaId: 'p1', name: 'Education Endowment Foundation', sightings: 1 },
      { actorId: 's2_002', personaId: 'p2', name: 'Education Endowment Foundation', sightings: 1 },
      { actorId: 's2_003', personaId: 'p3', name: 'Ofsted', sightings: 1 },
    ]);
    expect(groups).toHaveLength(2);
    const eef = groups.find((g) => g.name === 'Education Endowment Foundation')!;
    // Two library records under one name — the split the reader needs to SEE.
    expect(eef.records).toHaveLength(2);
    // ...but one body, carrying both of this run's actor rows.
    expect(eef.here).toHaveLength(2);
    // Most exposed first: worst of the group, not of whichever row came first.
    expect(groups[0].name).toBe('Education Endowment Foundation');
    expect(eef.worst).toBe(0.8);
  });

  it('leaves out actors the library has never met', () => {
    const board = [{ actor: actorOf('s2_001', 'Nobody'), profile: null, plays: [], worst: 0 }];
    expect(view.personaBoard(board, [])).toEqual([]);
  });
});
