// The cross-policy stage: the brief's "weaknesses that span more than one policy".
import { describe, expect, it, vi } from 'vitest';
import { artefact, type Artefact } from './contracts';
import { executeStage, type Neighbour } from './pipeline';
import { crossIdentityHints } from './entities';

const source = artefact('passage_0001', 'passage', 'Page 1', 'The council is accountable for delivery and bears its costs.', { documentHash: 'a'.repeat(64) }, { origin: 'extracted_fact', confidence: 1, startOffset: 0, endOffset: 60 });
const actor = artefact('s2_0_council', 'actor', 'Barchester Council', 'The delivery body.', { entityType: 'local_authority', aliases: ['the council'], mentions: ['passage_0001'], ambiguity: 'None.', dates: [], parent: null }, { refs: ['passage_0001'], origin: 'extracted_fact', sourceId: 'passage_0001', sourceQuote: 'The council is accountable for delivery' });
const mechanism = artefact('s1_0_mechanism', 'mechanism', 'Delivery duty', 'A duty to deliver.', { intervention: 'Duty', implementation: 'Council', notes: 'No funding named.' }, { refs: ['passage_0001'], origin: 'extracted_fact', sourceId: 'passage_0001', sourceQuote: 'accountable for delivery' });
const all = [source, actor, mechanism];

const neighbour: Neighbour = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Waste collection reform', policyArea: 'Environment', jurisdiction: 'England', completedAt: '2026-09-01T00:00:00.000Z',
  artefacts: [
    { id: 'n_actor_1', kind: 'actor', label: 'Barchester Council', statement: 'The delivery body.', entityType: 'local_authority', aliases: ['the council'] },
    { id: 'n_mech_1', kind: 'mechanism', label: 'Weekly collection duty', statement: 'A duty to collect weekly.' },
  ],
};

const exposure = (prefix: string, otherAnalysisId: string): Artefact =>
  artefact(`${prefix}conflict`, 'cross_policy', 'Two duties, one budget', 'Both policies place an unfunded duty on the same council in the same year.', {
    pattern: 'cumulative_burden', otherAnalysisId, otherAnalysisTitle: neighbour.title, otherArtefactIds: ['n_mech_1'], actorId: actor.id,
    interaction: 'The same body carries both duties.', consequence: 'One of the two will be met in name only.', severity: 0.7,
    evidenceLimits: 'Neither paper states a budget.', action: 'Sequence the two commencement dates.',
  }, { refs: [actor.id, mechanism.id], origin: 'structural_inference', confidence: 0.6 });

const input = { stage: 11, title: 'Barchester delivery plan', jurisdiction: null, policyArea: null, context: null, artefacts: all };
const research = async () => ({ artefacts: [], warnings: [] });
const signal = new AbortController().signal;

describe('cross-policy exposure', () => {
  it('reads the other assessments and keeps a substantiated exposure', async () => {
    const model = vi.fn(async (_stage: number, _key: string, raw: unknown) => {
      const payload = raw as { idPrefix: string; neighbours: Neighbour[]; identity: { verdict: string }[] };
      expect(payload.neighbours).toHaveLength(1);
      expect(payload.identity[0]).toMatchObject({ actorId: actor.id, otherArtefactId: 'n_actor_1', verdict: 'same_body' });
      return { artefacts: [exposure(payload.idPrefix, neighbour.id)], warnings: [] };
    });
    const output = await executeStage(input, { model, research, signal, neighbours: async () => [neighbour] });
    expect(output.artefacts).toHaveLength(1);
    expect(output.artefacts[0].data.pattern).toBe('cumulative_burden');
  });

  it('discards an exposure that names an assessment it was never given', async () => {
    const model = async (_stage: number, _key: string, raw: unknown) => ({ artefacts: [exposure((raw as { idPrefix: string }).idPrefix, '99999999-9999-4999-8999-999999999999')], warnings: [] });
    const output = await executeStage(input, { model, research, signal, neighbours: async () => [neighbour] });
    expect(output.artefacts).toEqual([]);
    expect(output.warnings.join(' ')).toContain('named an assessment that was not supplied');
  });

  it('completes and says so when there is nothing to compare against', async () => {
    const model = vi.fn();
    const output = await executeStage(input, { model, research, signal, neighbours: async () => [] });
    expect(model).not.toHaveBeenCalled();
    expect(output.artefacts).toEqual([]);
    expect(output.warnings.join(' ')).toContain('No other completed policy assessment');
  });
});

describe('identity across an analysis boundary', () => {
  it('will not call two different kinds of body the same body on a shared name', () => {
    const hints = crossIdentityHints([actor], [{ id: neighbour.id, artefacts: [{ id: 'n_x', kind: 'actor', label: 'Barchester Council', entityType: 'person', aliases: [] }] }]);
    expect(hints).toHaveLength(1);
    expect(hints[0].verdict).toBe('possibly_same');
  });
  it('ignores an actor with no relationship to anything here', () => {
    expect(crossIdentityHints([actor], [{ id: neighbour.id, artefacts: [{ id: 'n_y', kind: 'actor', label: 'Department for Transport', entityType: 'department', aliases: [] }] }])).toEqual([]);
  });
});
