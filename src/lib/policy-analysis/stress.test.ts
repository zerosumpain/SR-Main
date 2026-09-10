// The stress test: failing a hypothesis, and the two opposite things that does.
import { describe, expect, it } from 'vitest';
import { artefact, type Artefact } from './contracts';
import { leverage, stress } from './stress';

const assumption = (id: string) => artefact(id, 'assumption', `Assumption ${id}`, 'It is assumed.', { importance: 0.9, uncertainty: 0.8, consequence: 0.7, priority: 0.5, notes: 'x' }, { refs: ['s2_0'] });

const corpus = (): Artefact[] => [
  assumption('a1'), assumption('a2'),
  artefact('m1', 'model', 'A model', 'x', { pattern: 'principal_agent', players: ['s2_0'], assumptions: ['a1'], strategies: [], decisionOrder: '', information: '', costs: '', benefits: '', rewards: '', sanctions: '', dependencies: [], responses: [], equilibria: [], explanation: '', applicability: '' }, { refs: ['a1'] }),
  artefact('x1', 'exploit', 'A play', 'x', { actorId: 's2_0', motivation: '', play: '', legality: 'compliant', targets: ['mech'], preconditions: ['a2'], payoff: '', costToPolicy: '', incentive: 0.8, ease: 0.8, impact: 0.8, concealment: 0.5, exposure: 0.7, band: 'severe', earlyWarning: '', counter: '', precedent: '' }, { refs: ['a2'] }),
  artefact('f1', 'finding', 'Rests on a1', 'x', { section: 'objectives', resultIds: ['m1'], hypothesisIds: ['a1'] }, { refs: ['m1', 'a1'] }),
  artefact('f2', 'finding', 'Rests on the play', 'x', { section: 'exploitation', resultIds: ['x1'], hypothesisIds: ['a2'] }, { refs: ['x1', 'a2'] }),
  artefact('r1', 'recommendation', 'Change it', 'x', { findingIds: ['f1'], change: '', tradeoffs: '', beneficiaries: [], burdenBearers: [], validationNeeded: '' }, { refs: ['f1'], origin: 'normative_judgement' }),
  artefact('t1', 'test', 'A check', 'x', { testId: 'c1', rationale: '', inputs: [], rule: '', reasoning: '', result: 'high_risk', severity: 'high', actors: [], mitigation: '' }, { refs: ['s2_0'] }),
];

describe('failing an assumption', () => {
  it('takes the footing out from under what rests on it', () => {
    const result = stress(corpus(), ['a1']);
    expect(result.models[0].standing).toBe('unsupported');
    expect(result.findings.find((r) => r.artefact.id === 'f1')?.standing).toBe('unsupported');
    expect(result.recommendations[0].standing).toBe('unsupported');
  });

  it('DISARMS a play instead, because the actor needed it to be true', () => {
    const result = stress(corpus(), ['a2']);
    expect(result.plays[0].standing).toBe('disarmed');
    expect(result.plays[0].because[0]).toContain('needs');
  });

  it('leaves the deterministic checks exactly where they were', () => {
    // The structural checks read the relationships the policy itself states, so
    // they are the one part of the assessment no hypothesis can move. Saying so
    // is part of the answer.
    expect(stress(corpus(), ['a1', 'a2']).checksHeld).toBe(1);
  });

  it('cascades to a conclusion that cited a result which has stopped standing', () => {
    const result = stress(corpus(), ['a2']);
    const f2 = result.findings.find((r) => r.artefact.id === 'f2');
    expect(f2?.standing).toBe('unsupported');
    expect(f2?.because.join(' ')).toContain('no longer stands');
  });

  it('changes nothing at all when nothing is failed', () => {
    const result = stress(corpus(), []);
    expect(result.counts.total).toBe(0);
    expect(result.plays.every((p) => p.standing === 'holds')).toBe(true);
  });

  it('weakens rather than guts a conclusion that keeps one of its hypotheses', () => {
    const all = corpus();
    all.push(artefact('f3', 'finding', 'Rests on both', 'x', { section: 'objectives', resultIds: ['m1', 'x1'], hypothesisIds: ['a1', 'a2'] }, { refs: ['m1', 'x1', 'a1', 'a2'] }));
    expect(stress(all, ['a1']).findings.find((r) => r.artefact.id === 'f3')?.standing).toBe('weakened');
  });
});

describe('which assumptions are worth offering as a switch', () => {
  it('offers only the ones something actually cites', () => {
    const all = [...corpus(), assumption('a3')];
    expect(leverage(all).map((l) => l.artefact.id)).toEqual(['a1', 'a2']);
  });

  it('puts the most load-bearing first', () => {
    const all = corpus();
    all.push(artefact('f4', 'finding', 'Also a1', 'x', { section: 'actors', resultIds: ['m1'], hypothesisIds: ['a1'] }, { refs: ['m1', 'a1'] }));
    expect(leverage(all)[0].artefact.id).toBe('a1');
    expect(leverage(all)[0].dependants).toBe(3);
  });
});
