// Regression cover for the way the first production run of /policy-analysis died.
//
// A real 20-page government PDF was submitted on 2026-09-09. Stage 1 made two
// model calls: the first succeeded, the second was rejected six times over three
// different rules, and the run ended with nothing but the ingested passages. In
// every one of those six responses the analysis itself was sound.
//
// Each test below is one of those rejections.
import { describe, expect, it, vi } from 'vitest';
import { artefact, PATTERNS, type Artefact } from './contracts';
import { locateQuote } from './quotes';
import { PolicyError, triageArtefacts, triageOutput, validateOutput } from './validation';
import { encodedSize, fitToBudget } from './budget';
import { executeStage } from './pipeline';
import { fixtureModel } from '../../../tests/fixtures/policy-analysis/model';
import { ingest } from './server/ingest';
import { readFileSync } from 'node:fs';

// The real passage_10 of that document, wrapped exactly as extractPdf hands it over.
const WRAPPED = `Reshaping consumer regulation: Our implementation plan
9
New consumer standards
Our new consumer standards will be outcome focused. This means that we focus on what
landlords achieve, but we do not prescribe how they should do it. We are also
committed to building on our current standards, keeping those parts which remain relevant.`;

const passage = (id: string, text = WRAPPED) => artefact(id, 'passage', `Page 9 · ${id}`, text, { documentHash: 'a'.repeat(64) }, { origin: 'extracted_fact', confidence: 1, page: 9, section: 'Page 9', startOffset: 0, endOffset: text.length });

/** A valid stage-1 inventory for one passage, the shape the model actually returns. */
function decomposition(prefix: string, source: Artefact, quote: string) {
  const cited = { origin: 'extracted_fact' as const, sourceId: source.id, sourceQuote: quote, refs: [source.id] };
  return {
    artefacts: [
      { ...artefact(`${prefix}claim`, 'claim', 'Outcome focus', 'The standards are said to be outcome focused.', { category: 'objective', notes: 'Stated, not evaluated.' }), ...cited },
      { ...artefact(`${prefix}mechanism`, 'mechanism', 'Outcome standards', 'Standards specify outcomes rather than methods.', { intervention: 'Outcome standards', implementation: 'Unspecified', notes: 'No delivery detail.' }), ...cited },
      { ...artefact(`${prefix}actor`, 'actor', 'Landlords', 'Registered providers subject to the standards.', { entityType: 'provider', aliases: ['landlords'], mentions: [source.id], ambiguity: 'Scope undefined.', dates: [], parent: null }), ...cited },
      artefact(`${prefix}assumption`, 'assumption', 'Landlords can adapt', 'Landlords are assumed able to choose their own methods.', { importance: 0.8, uncertainty: 0.7, consequence: 0.8, notes: 'Untested.' }, { refs: [source.id, `${prefix}mechanism`] }),
    ],
    warnings: [],
  };
}

describe('locating a quotation in extracted document text', () => {
  it('finds a quotation that the PDF wrapped across a line', () => {
    // This is the exact quote, and the exact text, that ended the production run.
    expect(WRAPPED.includes('what landlords achieve')).toBe(false);
    const found = locateQuote(WRAPPED, 'what landlords achieve');
    expect(found).not.toBeNull();
    expect(found!.exact).toBe(false);
    expect(WRAPPED.slice(found!.start, found!.end)).toBe('what\nlandlords achieve');
    expect(found!.quote).toBe('what\nlandlords achieve');
  });
  it('rejoins a word the typesetter hyphenated across a line', () => {
    const source = 'The plan sets out our imple-\nmentation timetable.';
    expect(locateQuote(source, 'our implementation timetable')).not.toBeNull();
  });
  it('reads through smart punctuation, ligatures and case', () => {
    const source = 'The regulator’s oﬃce — established in 2023 — reports annually.';
    expect(locateQuote(source, "the regulator's office - established in 2023")).not.toBeNull();
  });
  it('still refuses a quotation that is not in the text', () => {
    expect(locateQuote(WRAPPED, 'invented quote')).toBeNull();
    expect(locateQuote(WRAPPED, 'landlords must publish an annual return')).toBeNull();
    expect(locateQuote(WRAPPED, '   ')).toBeNull();
  });
  it('reports offsets into the original text, not the folded copy', () => {
    const found = locateQuote(WRAPPED, 'outcome focused')!;
    expect(WRAPPED.slice(found.start, found.end)).toBe('outcome focused');
  });
});

describe('a faulty artefact is quarantined, not fatal', () => {
  const source = passage('passage_0001');
  const good = decomposition('s1_a_', source, 'what landlords achieve');

  it('keeps the assessment when the model echoes a supplied artefact back', () => {
    const withEcho = { artefacts: [source, ...good.artefacts], warnings: [] };
    expect(() => validateOutput(withEcho, 1, [source])).toThrow('duplicate');
    const triaged = triageOutput(withEcho, 1, [source]);
    expect(triaged.artefacts).toHaveLength(4);
    expect(triaged.rejected.map((r) => r.code)).toEqual(['duplicate']);
    expect(triaged.warnings.join(' ')).toContain('passage_0001');
  });

  it('keeps the assessment when the model emits a kind belonging to another stage', () => {
    const stray = artefact('s1_a_edge', 'edge', 'Accountability', 'Out of stage.', { notes: 'n' }, { refs: [source.id], fromId: source.id, toId: source.id, relation: 'is_accountable_for', temporal: 'proposed' });
    const triaged = triageOutput({ artefacts: [...good.artefacts, stray], warnings: [] }, 1, [source]);
    expect(triaged.artefacts.map((a) => a.id)).not.toContain('s1_a_edge');
    expect(triaged.artefacts).toHaveLength(4);
    expect(triaged.rejected[0]).toMatchObject({ id: 's1_a_edge', code: 'contract' });
  });

  it('rewrites a located quotation to the document’s own wording and offsets', () => {
    const triaged = triageOutput(good, 1, [source]);
    expect(triaged.rejected).toEqual([]);
    const claim = triaged.artefacts.find((a) => a.kind === 'claim')!;
    expect(claim.sourceQuote).toBe('what\nlandlords achieve');
    expect(source.statement.slice(claim.startOffset!, claim.endOffset!)).toBe('what\nlandlords achieve');
    expect(claim.page).toBe(9);
  });

  it('still discards a fabricated quotation rather than trusting it', () => {
    const fake = structuredClone(good);
    fake.artefacts[0].sourceQuote = 'landlords must publish an annual return';
    const triaged = triageOutput(fake, 1, [source]);
    expect(triaged.rejected.map((r) => r.code)).toContain('span');
    expect(triaged.artefacts.map((a) => a.kind)).not.toContain('claim');
  });

  it('cascades: what depended on a discarded artefact goes with it', () => {
    const broken = structuredClone(good);
    broken.artefacts[1].sourceQuote = 'a quotation that is not in the document';
    const triaged = triageOutput(broken, 1, [source]);
    // The mechanism fails its span check; the assumption that referenced it cannot stand.
    expect(triaged.artefacts.map((a) => a.id).sort()).toEqual(['s1_a_actor', 's1_a_claim']);
    expect(triaged.rejected.map((r) => r.id).sort()).toEqual(['s1_a_assumption', 's1_a_mechanism']);
  });

  it('leaves the strict gate strict, so every rule still has a test', () => {
    const echo = { artefacts: [source, ...good.artefacts], warnings: [] };
    expect(() => validateOutput(echo, 1, [source])).toThrow();
    expect(() => validateOutput({ artefacts: [{ ...good.artefacts[0], refs: ['nope'] }], warnings: [] }, 1, [source])).toThrow('unavailable');
  });
});

describe('a stage survives the loss of part of its fan-out', () => {
  const sources = ['passage_0001', 'passage_0002', 'passage_0003', 'passage_0004'].map((id) => passage(id));
  const input = { stage: 1, title: 'Reshaping consumer regulation', jurisdiction: null, policyArea: null, context: null, artefacts: sources };
  const research = async () => ({ artefacts: [], warnings: [] });
  const signal = new AbortController().signal;

  it('records the passage it could not read and assesses the rest', async () => {
    const model = vi.fn(async (_stage: number, key: string) => {
      if (key === 'passage_0002') throw new PolicyError('span', 'An extracted assertion could not be located in the policy text.');
      return decomposition(`s1_${key}_`, sources.find((s) => s.id === key)!, 'what landlords achieve');
    });
    const output = await executeStage(input, { model, research, signal });
    expect(model).toHaveBeenCalledTimes(4);
    expect(output.artefacts).toHaveLength(12);
    expect(output.warnings.join(' ')).toContain('passage_0002');
    expect(output.warnings.join(' ')).toContain('missing from this stage');
  });

  it('stops early rather than burning the whole document on a dead provider', async () => {
    const model = vi.fn(async () => { throw new PolicyError('provider', 'The configured model provider is unavailable.'); });
    await expect(executeStage(input, { model, research, signal })).rejects.toThrow('consecutive');
    expect(model).toHaveBeenCalledTimes(3);
  });

  it('still fails the stage when nothing usable came back at all', async () => {
    const model = vi.fn(async () => ({ artefacts: [], warnings: [] }));
    await expect(executeStage(input, { model, research, signal })).rejects.toThrow('required claim, mechanism, assumption and actor inventory');
  });
});

describe('a fixed library reports its gaps instead of losing the run', () => {
  const build = async () => {
    const fixture = readFileSync('tests/fixtures/policy-analysis/policy.txt');
    const all = (await ingest(fixture, 'policy.txt', 'text/plain')).artefacts;
    const research = async () => ({ artefacts: [], warnings: ['Synthetic test: external research unavailable.'] });
    const signal = new AbortController().signal;
    for (let stage = 1; stage <= 6; stage++) {
      const result = await executeStage({ stage, title: 'Synthetic policy', jurisdiction: null, policyArea: null, context: null, artefacts: all }, { model: async (...args) => fixtureModel(...args), research, signal });
      all.push(...result.artefacts);
    }
    return { all, research, signal };
  };

  it('completes with a named gap when a minority of the library fails', async () => {
    const { all, research, signal } = await build();
    const skipped = new Set([PATTERNS[1], PATTERNS[3], PATTERNS[5]]);
    const model = async (stage: number, key: string, raw: unknown) => {
      if (skipped.has(key as (typeof PATTERNS)[number])) throw new PolicyError('contract', 'Synthetic contract failure.');
      return fixtureModel(stage, key, raw);
    };
    const output = await executeStage({ stage: 7, title: 'Synthetic policy', jurisdiction: null, policyArea: null, context: null, artefacts: all }, { model, research, signal });
    expect(output.artefacts.filter((a) => a.kind === 'model')).toHaveLength(PATTERNS.length - 3);
    expect(output.warnings.join(' ')).toContain('3 of 8 interaction models were not assessed');
    expect(output.warnings.join(' ')).toContain('collective action');
  });

  it('fails the stage when most of the library could not be assessed', async () => {
    const { all, research, signal } = await build();
    let calls = 0;
    const model = async (stage: number, key: string, raw: unknown) => {
      // Fail every other pattern, so the run never trips the consecutive-failure guard.
      if (calls++ % 2 === 0) throw new PolicyError('contract', 'Synthetic contract failure.');
      return fixtureModel(stage, key, raw);
    };
    await expect(executeStage({ stage: 7, title: 'Synthetic policy', jurisdiction: null, policyArea: null, context: null, artefacts: all }, { model, research, signal })).rejects.toThrow('of 8 interaction models could be assessed');
  });
});

describe('fitting a stage into the model context window', () => {
  const big = (id: string, chars: number, kind: Artefact['kind'] = 'research_source') =>
    artefact(id, kind, `Source ${id}`, 'x'.repeat(chars), kind === 'research_source' ? { questionId: 'q', retrievedAt: '', quality: '', qualityBasis: '', freshness: '', jurisdictionalRelevance: '', retrieval: 'full_text', gap: '' } : { documentHash: 'a'.repeat(64) });

  it('clips the longest retrieved text rather than refusing to run', () => {
    // Eight questions x three results x 10,000 characters is the real research ceiling.
    const sources = Array.from({ length: 24 }, (_, i) => big(`source_${i}`, 10_000));
    const build = (a: Artefact[]) => ({ stage: 6, artefacts: a });
    expect(encodedSize(build(sources))).toBeGreaterThan(180_000);
    const fitted = fitToBudget(sources, build, 180_000);
    expect(encodedSize(build(fitted.artefacts))).toBeLessThanOrEqual(180_000);
    expect(fitted.artefacts).toHaveLength(24);
    expect(fitted.notes.join(' ')).toContain('reduced');
  });

  it('says plainly what the model was not shown', () => {
    const fitted = fitToBudget(Array.from({ length: 400 }, (_, i) => big(`source_${i}`, 10_000)), (a) => ({ artefacts: a }), 40_000);
    expect(fitted.artefacts.length).toBeLessThan(400);
    expect(fitted.notes.join(' ')).toContain('withheld from this call entirely');
  });

  it('leaves a payload that already fits completely alone', () => {
    const small = [big('passage_0001', 200, 'passage')];
    const fitted = fitToBudget(small, (a) => ({ artefacts: a }), 180_000);
    expect(fitted.artefacts).toBe(small);
    expect(fitted.notes).toEqual([]);
  });
});

describe('a stage aggregate is not a single model response', () => {
  it('accepts more warnings and artefacts than one response may carry', () => {
    const source = passage('passage_0001');
    const good = decomposition('s1_a_', source, 'what landlords achieve');
    const warnings = Array.from({ length: 250 }, (_, i) => `Passage ${i} could not be assessed.`);
    // The single-response envelope caps warnings at 100 and would reject this.
    expect(() => validateOutput({ artefacts: good.artefacts, warnings }, 1, [source])).toThrow('invalid structured');
    const triaged = triageArtefacts({ artefacts: good.artefacts, warnings }, 1, [source]);
    expect(triaged.artefacts).toHaveLength(4);
    expect(triaged.warnings).toHaveLength(60);
    expect(triaged.warnings.at(-1)).toContain('191 further warnings');
  });
});
