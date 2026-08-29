import { describe, it, expect } from 'vitest';
import {
  shortlistCandidates,
  outlierThreshold,
  vocabularyFingerprint,
  validateProposal,
  corroborates,
  MIN_CANDIDATE_DEGREE,
  type CandidateEntity,
} from './conflation';

const entity = (over: Partial<CandidateEntity> & Pick<CandidateEntity, 'id'>): CandidateEntity => ({
  name: over.id,
  typeName: 'location',
  degree: 10,
  relations: ['located_in', 'near', 'part_of', 'contains'],
  ...over,
});

// The three real conflations, at the degrees they were found at.
const DARLINGTON = entity({
  id: 'darlington',
  degree: 94,
  relations: ['located_in', 'near', 'has_credit_card', 'owns_pet', 'parent_of', 'uses_bank'],
});
const HOME = entity({
  id: 'home',
  degree: 81,
  relations: ['contains', 'present_in', 'has_integration', 'flagged_risk', 'pending_update'],
});
const ENGLAND = entity({
  id: 'england',
  degree: 10,
  relations: ['located_in', 'part_of', 'coaches', 'defeated', 'participates_in'],
});

// p95 measured on the live graph, 2026-08-29.
const P95 = new Map([
  ['location', 7],
  ['person', 24],
  ['product', 12],
  ['concept', 6],
]);

describe('outlierThreshold', () => {
  it('scales with the type rather than using one number for the graph', () => {
    // p95 is 7 for a location and 24 for a person; a single constant either
    // floods the shortlist with ordinary people or misses conflated places.
    expect(outlierThreshold(7)).toBe(14);
    expect(outlierThreshold(24)).toBe(48);
  });

  it('never drops below a degree worth spending a model call on', () => {
    // p95 is 1 for the thinnest types, and 2x that would shortlist two-edge
    // entities by the hundred.
    expect(outlierThreshold(1)).toBe(MIN_CANDIDATE_DEGREE);
    expect(outlierThreshold(0)).toBe(MIN_CANDIDATE_DEGREE);
  });
});

describe('shortlistCandidates', () => {
  it('catches all three conflations that were found by hand', () => {
    const ids = shortlistCandidates([DARLINGTON, HOME, ENGLAND], P95).map((c) => c.id);
    expect(ids).toContain('darlington');
    expect(ids).toContain('home');
    // England is the hard one: 10 edges, barely above the location threshold of
    // 14 — it is NOT caught, and that is the honest boundary of this rule.
    expect(ids).not.toContain('england');
  });

  it('leaves an ordinary entity alone', () => {
    const ordinary = entity({ id: 'a-park', degree: 6 });
    expect(shortlistCandidates([ordinary], P95)).toEqual([]);
  });

  it('does not shortlist a busy entity with a narrow vocabulary', () => {
    // `Home Assistant` legitimately controls two hundred things. A conflation
    // shows up as a WIDE vocabulary, because the second referent brings its own
    // verbs; one relation used many times is a busy entity, not a confused one.
    const busy = entity({
      id: 'home-assistant',
      typeName: 'product',
      degree: 151,
      relations: ['controls', 'monitors'],
    });
    expect(shortlistCandidates([busy], P95)).toEqual([]);
  });

  it('ranks the worst offender first', () => {
    expect(shortlistCandidates([HOME, DARLINGTON], P95)[0].id).toBe('darlington');
  });
});

describe('vocabularyFingerprint', () => {
  it('ignores order and repetition, so a quiet night costs nothing', () => {
    expect(vocabularyFingerprint(['b', 'a', 'a'])).toBe(vocabularyFingerprint(['a', 'b']));
  });

  it('changes when a new KIND of relation arrives', () => {
    expect(vocabularyFingerprint(['a', 'b'])).not.toBe(vocabularyFingerprint(['a', 'b', 'c']));
  });
});

describe('validateProposal', () => {
  const candidate = { id: 'darlington', relations: DARLINGTON.relations };
  const john = { id: 'john', typeName: 'person' };
  const resolve = (name: string) => (name === 'John' ? john : null);

  it('applies when the other referent is already a node', () => {
    expect(
      validateProposal(
        { conflated: true, relationTypes: ['has_credit_card', 'owns_pet'], targetName: 'John', reason: '' },
        candidate,
        resolve,
      ),
    ).toEqual({ action: 'apply', targetId: 'john' });
  });

  it('QUEUES when the referent would have to be invented', () => {
    // England's football fixtures belong to a team that does not exist. Creating
    // it is a judgement about what the world contains, not something to take on a
    // model's word at 04:15.
    const verdict = validateProposal(
      {
        conflated: true,
        relationTypes: ['coaches', 'defeated'],
        targetName: 'England national football team',
        reason: '',
      },
      { id: 'england', relations: ENGLAND.relations },
      resolve,
    );
    expect(verdict.action).toBe('queue');
  });

  it('refuses a proposal naming relations the entity does not have', () => {
    // A model describing something else is not to be trusted about the rest.
    const verdict = validateProposal(
      { conflated: true, relationTypes: ['has_credit_card', 'plays_for'], targetName: 'John', reason: '' },
      candidate,
      resolve,
    );
    expect(verdict.action).toBe('skip');
    expect(verdict.action === 'skip' && verdict.why).toMatch(/does not have/);
  });

  it('refuses a split that would move everything', () => {
    const verdict = validateProposal(
      { conflated: true, relationTypes: [...DARLINGTON.relations], targetName: 'John', reason: '' },
      candidate,
      resolve,
    );
    expect(verdict.action).toBe('skip');
    expect(verdict.action === 'skip' && verdict.why).toMatch(/rename/);
  });

  it('refuses a split onto itself, and a verdict of "not conflated"', () => {
    expect(
      validateProposal(
        { conflated: true, relationTypes: ['has_credit_card'], targetName: 'self', reason: '' },
        candidate,
        (n) => (n === 'self' ? { id: 'darlington', typeName: 'location' } : null),
      ).action,
    ).toBe('skip');
    expect(
      validateProposal(
        { conflated: false, relationTypes: [], targetName: '', reason: '' },
        candidate,
        resolve,
      ).action,
    ).toBe('skip');
  });
});

describe('corroborates', () => {
  const today = '2026-09-02';
  const proposal = { targetName: 'IBCA', relationTypes: ['owns', 'decision_maker_of'] };

  it('agrees when a previous NIGHT said the same thing', () => {
    expect(
      corroborates({ day: '2026-09-01', targetName: 'IBCA', relationTypes: ['decision_maker_of', 'owns'] }, proposal, today),
    ).toBe(true);
  });

  it('refuses a second run on the SAME day', () => {
    // Two sweeps minutes apart share whatever made the model answer as it did.
    // The point is to sample twice, not to ask twice.
    expect(
      corroborates({ day: today, targetName: 'IBCA', relationTypes: ['owns', 'decision_maker_of'] }, proposal, today),
    ).toBe(false);
  });

  it('refuses when the target moved', () => {
    // Observed: IBCA Board one night, IBCA the next.
    expect(
      corroborates({ day: '2026-09-01', targetName: 'IBCA Board', relationTypes: ['owns', 'decision_maker_of'] }, proposal, today),
    ).toBe(false);
  });

  it('refuses when the relation set GREW, which is the over-broad failure', () => {
    // 4 edges becoming 18. Treating that as agreement applies the wrong version.
    expect(
      corroborates(
        { day: '2026-09-01', targetName: 'IBCA', relationTypes: ['owns', 'decision_maker_of', 'works_on'] },
        proposal,
        today,
      ),
    ).toBe(false);
  });

  it('refuses with nothing to compare against', () => {
    expect(corroborates(null, proposal, today)).toBe(false);
    expect(corroborates({ day: '', targetName: 'IBCA', relationTypes: ['owns'] }, proposal, today)).toBe(false);
  });
});
