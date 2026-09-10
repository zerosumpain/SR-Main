// The three places this feature could leak or be led by the nose.
import { describe, expect, it } from 'vitest';
import { artefact, SYNTHESIS_STAGE, type Artefact } from './contracts';
import { documentShingles, quotesDocument } from './query-guard';
import { executeStage } from './pipeline';
import { safeSourceUrl } from './contracts';

const text = `Subject to the Bill being passed by Parliament, and Government issuing the relevant
Directions, we will consult on the new standards by the summer of 2023. These may be subject to
further change as we continue to engage with tenants and landlords.`;
const passage = artefact('passage_0001', 'passage', 'Page 9', text, { documentHash: 'a'.repeat(64) }, { origin: 'extracted_fact', confidence: 1, startOffset: 0, endOffset: text.length });

describe('the document does not reach the search provider', () => {
  const corpus = documentShingles([passage]);

  it('refuses a query that reproduces a run of the paper', () => {
    expect(quotesDocument('we will consult on the new standards by the summer of 2023', corpus)).toBe(true);
    expect(quotesDocument('subject to the bill being passed by parliament', corpus)).toBe(true);
  });

  it('allows an ordinary public query about the same subject', () => {
    expect(quotesDocument('social housing consumer standards consultation timetable', corpus)).toBe(false);
    expect(quotesDocument('Regulator of Social Housing enforcement powers evidence', corpus)).toBe(false);
  });

  it('does nothing when there is no document to protect', () => {
    expect(quotesDocument('anything at all here', new Set())).toBe(false);
  });

  it('drops the question rather than the run when a query would quote', async () => {
    const assumption = artefact('s1_0_assumption', 'assumption', 'Timetable holds', 'The consultation timetable is assumed to hold.', { importance: 0.9, uncertainty: 0.9, consequence: 0.9, notes: 'Untested.' }, { refs: ['passage_0001', 's1_0_mechanism'] });
    const mechanism = artefact('s1_0_mechanism', 'mechanism', 'Consultation', 'A consultation is promised.', { intervention: 'Consultation', implementation: 'RSH', notes: 'No date fixed.' }, { refs: ['passage_0001'], origin: 'extracted_fact', sourceId: 'passage_0001', sourceQuote: 'we will consult on the new standards' });
    const model = async (_stage: number, _key: string, raw: unknown) => ({
      artefacts: [artefact(`${(raw as { idPrefix: string }).idPrefix}q`, 'research_question', 'Timetable', 'Will the timetable hold?', { importance: 0.9, uncertainty: 0.9, consequence: 0.9, rationale: 'It gates everything.', searchStrategy: 'we will consult on the new standards by the summer of 2023', gap: 'Unknown.' }, { refs: ['s1_0_assumption'] })],
      warnings: [],
    });
    let searched = 0;
    const research = async () => { searched++; return { artefacts: [], warnings: [] }; };
    const output = await executeStage({ stage: 5, title: 'A policy', jurisdiction: null, policyArea: null, context: null, artefacts: [passage, mechanism, assumption] }, { model, research, signal: new AbortController().signal });
    expect(searched).toBe(0);
    expect(output.warnings.join(' ')).toContain('quoted the policy document');
  });
});

describe('evidence comes from retrieval, never from the model', () => {
  it('discards a source the model minted, with its URL', async () => {
    const assumption = artefact('s1_0_assumption', 'assumption', 'Capacity', 'Capacity is assumed.', { importance: 0.9, uncertainty: 0.9, consequence: 0.9, notes: 'Untested.' }, { refs: ['passage_0001', 's1_0_mechanism'] });
    const mechanism = artefact('s1_0_mechanism', 'mechanism', 'Duty', 'A duty.', { intervention: 'Duty', implementation: 'RSH', notes: 'None.' }, { refs: ['passage_0001'], origin: 'extracted_fact', sourceId: 'passage_0001', sourceQuote: 'engage with tenants and landlords' });
    const model = async (_stage: number, _key: string, raw: unknown) => {
      const prefix = (raw as { idPrefix: string }).idPrefix;
      return {
        artefacts: [
          artefact(`${prefix}q`, 'research_question', 'Capacity', 'Is there capacity?', { importance: 0.5, uncertainty: 0.5, consequence: 0.5, rationale: 'Capacity gates delivery.', searchStrategy: 'local authority delivery capacity evaluation', gap: 'Unknown.' }, { refs: ['s1_0_assumption'] }),
          artefact(`${prefix}fake`, 'research_source', 'A source I made up', 'Trust me.', { questionId: `${prefix}q`, retrievedAt: '2026-01-01', quality: 'government', qualityBasis: 'n', freshness: 'n', jurisdictionalRelevance: 'n', retrieval: 'full_text', gap: 'n' }, { refs: [`${prefix}q`], origin: 'external_evidence', url: 'https://example.invalid/made-up' }),
        ],
        warnings: [],
      };
    };
    const research = async () => ({ artefacts: [], warnings: [] });
    const output = await executeStage({ stage: 5, title: 'A policy', jurisdiction: null, policyArea: null, context: null, artefacts: [passage, mechanism, assumption] }, { model, research, signal: new AbortController().signal });
    expect(output.artefacts.filter((a: Artefact) => a.kind === 'research_source')).toEqual([]);
    expect(output.warnings.join(' ')).toContain('model-authored source');
  });
});

describe('a citation URL must be public and plain', () => {
  it('refuses schemes, hosts and credentials that are not', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'http://127.0.0.1/', 'http://metadata.internal/', 'https://user:pw@public.example/', 'https://strangeramblings.com/admin', 'https://localhost/'])
      expect(safeSourceUrl(url)).toBeNull();
    expect(safeSourceUrl('https://www.gov.uk/guidance')).toBe('https://www.gov.uk/guidance');
  });
});

describe('synthesis is shown the results it is required to cite', () => {
  it('pins every test, model, scenario, exploit and cross-policy exposure into the call', async () => {
    // A finding must cite one of these kinds. They are the last things produced
    // and carry the lowest confidence, so the context budget shed the lot — and
    // the model, still required to cite a result, minted identifiers for results
    // it had never been shown. Every finding was then quarantined for citing an
    // unavailable source and the stage failed naming the missing chapters.
    const results: Artefact[] = [
      artefact('s8_test_1', 'test', 'A test', 'A structural check.', { check: 'c', result: 'fail', detail: 'd', resultIds: [] }, { refs: ['passage_0001'] }),
      artefact('s10_exploit_1', 'exploit', 'A play', 'A play.', { actorId: 's2_a', preconditions: [] }, { refs: ['passage_0001'] }),
      artefact('s9_scenario_1', 'scenario', 'A scenario', 'A scenario.', { scenario: 's', assumptions: [] }, { refs: ['passage_0001'] }),
    ];
    let pinned: string[] = [];
    const model = async (_stage: number, _key: string, raw: unknown) => {
      pinned = ((raw as { protect?: string[] }).protect ?? []).slice();
      return { artefacts: [], warnings: [] };
    };
    await executeStage(
      { stage: SYNTHESIS_STAGE, title: 'A policy', jurisdiction: null, policyArea: null, context: null, artefacts: [passage, ...results] },
      { model, research: async () => ({ artefacts: [], warnings: [] }), signal: new AbortController().signal },
    ).catch(() => null);
    expect(pinned.sort()).toEqual(['s10_exploit_1', 's8_test_1', 's9_scenario_1']);
  });
});
