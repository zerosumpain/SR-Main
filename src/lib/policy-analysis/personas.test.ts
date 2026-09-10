// The persona library: what may cross from one assessment into the next, and
// what may not.
import { describe, expect, it } from 'vitest';
import { artefact, PERSONA_STAGE, PERSONA_TRAITS, SYNTHESIS_STAGE, STAGES, type Artefact } from './contracts';
import { foldTraits, matchPersona, observationFromProfile, personaPrior, playsFor, type PersonaObservation, type PersonaRecord } from './personas';
import { executeStage } from './pipeline';

const persona = (over: Partial<PersonaRecord> = {}): PersonaRecord => ({
  id: '11111111-1111-4111-8111-111111111111', name: 'Department for Education', entityType: 'department',
  aliases: ['DfE'], summary: 'The department.', dossier: [], sightings: 2, researchedAt: null, updatedAt: null, ...over,
});

const field = (value: string, origin = 'extracted_fact') => ({ value, origin, confidence: 0.7, refs: ['passage_0001'] });

describe('the ordinals the report contract is written against', () => {
  it('keeps synthesis at 12 and the library after it', () => {
    // `SYNTHESIS_STAGE` was `STAGES.length - 1` until the library was appended
    // after it, which would have moved every report rule onto a stage that does
    // not write a report.
    expect(STAGES[SYNTHESIS_STAGE]).toBe('Synthesis');
    expect(STAGES[PERSONA_STAGE]).toBe('Actor persona library');
    expect(PERSONA_STAGE).toBe(STAGES.length - 1);
  });
});

describe('identity is decided by the site policy, not by a matching name', () => {
  it('links a body to its dossier on an alias', () => {
    const match = matchPersona({ id: 's2_0', label: 'Department for Education', entityType: 'department', aliases: [] }, [persona()]);
    expect(match?.persona.id).toBe(persona().id);
  });

  it('refuses to merge two bodies of different types that share a name', () => {
    const match = matchPersona({ id: 's2_0', label: 'Ofsted', entityType: 'person', aliases: [] }, [persona({ name: 'Ofsted', entityType: 'agency' })]);
    expect(match).toBeNull();
  });

  it('opens a NEW persona rather than guessing between two equally good matches', () => {
    const a = persona({ id: '11111111-1111-4111-8111-111111111111', name: 'The Authority' });
    const b = persona({ id: '22222222-2222-4222-8222-222222222222', name: 'The Authority' });
    expect(matchPersona({ id: 's2_0', label: 'The Authority', entityType: 'department', aliases: [] }, [a, b])).toBeNull();
  });
});

describe('a dossier accumulates without letting an inference overwrite a fact', () => {
  it('keeps an extracted fact when a later inference contradicts it', () => {
    const standing = [{ key: 'accountableTo', label: 'Who it answers to', value: 'Parliament', origin: 'extracted_fact', confidence: 0.9 }];
    const observed = [{ key: 'accountableTo', label: 'Who it answers to', value: 'Probably the Treasury', origin: 'structural_inference', confidence: 0.3 }];
    expect(foldTraits(standing, observed)[0].value).toBe('Parliament');
  });

  it('takes the better-grounded answer when a later assessment finds one', () => {
    const standing = [{ key: 'legalPowers', label: 'What it can compel or block', value: 'Unclear', origin: 'structural_inference', confidence: null }];
    const observed = [{ key: 'legalPowers', label: 'What it can compel or block', value: 'May direct a local authority', origin: 'extracted_fact', confidence: 0.9 }];
    expect(foldTraits(standing, observed)[0].value).toBe('May direct a local authority');
  });

  it('orders a dossier by the vocabulary so two personas read the same way', () => {
    const shuffled = [...PERSONA_TRAITS].reverse().map(([key, label]) => ({ key, label, value: key, origin: 'structural_inference', confidence: null }));
    expect(foldTraits([], shuffled).map((t) => t.key)).toEqual(PERSONA_TRAITS.map(([key]) => key));
  });
});

describe('what one assessment contributes', () => {
  const profile = artefact('s4_0_profile', 'profile', 'DfE', 'The department.', {
    actorId: 's2_0', formalRole: field('Sets the standards'), accountableTo: field('Parliament'),
    successCriteria: field('Attainment'), timeHorizon: field('unknown', 'structural_inference'),
    gainFromFailure: field('Nobody identified', 'behavioural_hypothesis'),
  }, { refs: ['s2_0'] });

  it('distils the profile into persona traits and drops the unknowns', () => {
    const traits = observationFromProfile(profile);
    expect(traits.map((t) => t.key)).toContain('accountableTo');
    expect(traits.map((t) => t.key)).toContain('mandate');
    // "unknown" is an honest profile answer and a useless dossier entry.
    expect(traits.map((t) => t.key)).not.toContain('timeHorizon');
  });

  it("counts the plays from the run rather than taking the model at its word", () => {
    const plays: Artefact[] = [
      artefact('s10_0_a', 'exploit', 'Re-base the measure', 'x', { actorId: 's2_0', exposure: 0.8, band: 'severe', legality: 'compliant' }),
      artefact('s10_0_b', 'exploit', 'Someone else entirely', 'x', { actorId: 's2_9', exposure: 0.9, band: 'severe', legality: 'grey' }),
    ];
    const mine = playsFor('s2_0', plays);
    expect(mine).toHaveLength(1);
    expect(mine[0].label).toBe('Re-base the measure');
  });
});

describe('a prior is bounded, and never reads the run it is enriching', () => {
  const observations: PersonaObservation[] = [
    { id: 'o1', personaId: persona().id, kind: 'assessment', analysisId: 'other', analysisTitle: 'Another policy', actorId: 's2_1', traits: [], plays: [{ label: 'Elsewhere', band: 'severe', exposure: 0.9, legality: 'grey' }], sources: [], note: null, observedAt: null },
    { id: 'o2', personaId: persona().id, kind: 'assessment', analysisId: 'this-one', analysisTitle: 'This policy', actorId: 's2_0', traits: [], plays: [{ label: 'Its own', band: 'severe', exposure: 0.95, legality: 'grey' }], sources: [], note: null, observedAt: null },
  ];

  it('excludes the running analysis from the track record', () => {
    const prior = personaPrior('s2_0', { persona: persona(), basis: 'Identical name' }, observations, 'this-one');
    expect(prior.trackRecord.map((p) => p.label)).toEqual(['Elsewhere']);
  });

  it('caps the traits it carries', () => {
    const dossier = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, label: `l${i}`, value: 'v', origin: 'structural_inference', confidence: null }));
    expect(personaPrior('s2_0', { persona: persona({ dossier }), basis: 'x' }, [], null).traits).toHaveLength(12);
  });
});

describe('the library never costs the assessment', () => {
  const actor = artefact('s2_0', 'actor', 'DfE', 'The department.', { entityType: 'department', aliases: [], mentions: ['s1_0_m'], ambiguity: 'none', dates: [], parent: null }, { refs: ['s1_0_m'] });
  const profile = artefact('s4_0_profile', 'profile', 'DfE', 'The department.', { actorId: 's2_0', accountableTo: field('Parliament') }, { refs: ['s2_0'] });
  const edge = artefact('s3_0_edge', 'edge', 'accountable', 'x', { notes: 'x' }, { refs: ['s2_0'], fromId: 's2_0', toId: 's2_0', relation: 'is_accountable_for', temporal: 'current' });

  it('records a dead provider as a warning rather than a failed stage', async () => {
    const model = async () => { throw new Error('provider down'); };
    const output = await executeStage(
      { stage: PERSONA_STAGE, title: 'A policy', jurisdiction: null, policyArea: null, context: null, artefacts: [actor, profile, edge] },
      { model: model as never, research: async () => ({ artefacts: [], warnings: [] }), signal: new AbortController().signal },
    ).catch((err) => err);
    // A thrown non-PolicyError still ends the stage; what must not happen is the
    // "this stage produced no artefacts" refusal on an empty but healthy library.
    expect(output).toBeInstanceOf(Error);
  });

  it('completes with nothing rather than refusing an empty library', async () => {
    const model = async () => ({ artefacts: [], warnings: [] });
    const output = await executeStage(
      { stage: PERSONA_STAGE, title: 'A policy', jurisdiction: null, policyArea: null, context: null, artefacts: [actor, profile, edge] },
      { model, research: async () => ({ artefacts: [], warnings: [] }), signal: new AbortController().signal },
    );
    expect(output.artefacts).toHaveLength(0);
    expect(output.warnings.join(' ')).toContain('Nothing in the assessment above depends on it');
  });

  it('reads the library without letting a failure to read it end the stage', async () => {
    let sawPrior = false;
    const model = async (_stage: number, _key: string, raw: unknown) => {
      sawPrior = Boolean((raw as { priorPersona?: unknown }).priorPersona);
      return { artefacts: [], warnings: [] };
    };
    const output = await executeStage(
      { stage: PERSONA_STAGE, title: 'A policy', jurisdiction: null, policyArea: null, context: null, artefacts: [actor, profile, edge] },
      { model, research: async () => ({ artefacts: [], warnings: [] }), signal: new AbortController().signal, personas: async () => { throw new Error('database down'); } },
    );
    expect(sawPrior).toBe(false);
    expect(output.warnings.join(' ')).toContain('persona library could not be read');
  });
});
