import { describe, it, expect } from 'vitest';
import {
  bringsNewData,
  laneFor,
  MIN_BRIDGE_SCORE,
  scoreCapability,
  slugForCapability,
  validateProposals,
} from './spec';

const KEYS = new Set(['q:0', 'intent:1', 'fault:metric_unknown:sleepPerformance', 'source:ha']);

const ok = {
  kind: 'data_source',
  title: 'Rail disruption feed for the Norwich line',
  need: 'Nothing here knows when a train is cancelled.',
  value: 'The morning briefing could say the 07:12 is off before he leaves.',
  consumer: 'shared',
  cites: ['q:0'],
};

describe('validateProposals', () => {
  it('admits a well-formed proposal that cites the pack', () => {
    const r = validateProposals({ capabilities: [ok] }, KEYS, { max: 3 });
    expect(r.admitted).toHaveLength(1);
    expect(r.admitted[0].kind).toBe('data_source');
    expect(r.dropped).toEqual([]);
  });

  it('drops a proposal citing nothing in the pack, and says which keys it invented', () => {
    const r = validateProposals({ capabilities: [{ ...ok, cites: ['q:99', 'made-up'] }] }, KEYS, { max: 3 });
    expect(r.admitted).toHaveLength(0);
    expect(r.dropped[0]).toContain('cites nothing in the pack');
    expect(r.dropped[0]).toContain('q:99');
  });

  it('drops a proposal with no citations at all', () => {
    const r = validateProposals({ capabilities: [{ ...ok, cites: [] }] }, KEYS, { max: 3 });
    expect(r.admitted).toHaveLength(0);
    expect(r.dropped[0]).toContain('no citations');
  });

  it('keeps only citations that were really in the pack', () => {
    const r = validateProposals({ capabilities: [{ ...ok, cites: ['q:0', 'nope', 'source:ha'] }] }, KEYS, { max: 3 });
    expect(r.admitted[0].cites).toEqual(['q:0', 'source:ha']);
  });

  it('refuses an unknown kind rather than coercing it', () => {
    const r = validateProposals({ capabilities: [{ ...ok, kind: 'dashboard' }] }, KEYS, { max: 3 });
    expect(r.admitted).toHaveLength(0);
    expect(r.dropped[0]).toContain('unknown kind "dashboard"');
  });

  it('refuses an unknown consumer', () => {
    const r = validateProposals({ capabilities: [{ ...ok, consumer: 'everyone' }] }, KEYS, { max: 3 });
    expect(r.dropped[0]).toContain('unknown consumer');
  });

  it('requires both a need and a value', () => {
    expect(validateProposals({ capabilities: [{ ...ok, value: '' }] }, KEYS, { max: 3 }).dropped[0]).toContain(
      'no value stated',
    );
    expect(validateProposals({ capabilities: [{ ...ok, need: '  ' }] }, KEYS, { max: 3 }).dropped[0]).toContain(
      'no need stated',
    );
  });

  it('drops a duplicate of an earlier proposal in the same answer', () => {
    const r = validateProposals({ capabilities: [ok, { ...ok }] }, KEYS, { max: 3 });
    expect(r.admitted).toHaveLength(1);
    expect(r.dropped[0]).toContain('duplicate');
  });

  it('honours the cap', () => {
    const many = [1, 2, 3, 4].map((n) => ({ ...ok, title: `${ok.title} ${n}` }));
    expect(validateProposals({ capabilities: many }, KEYS, { max: 2 }).admitted).toHaveLength(2);
  });

  it('says so when the answer has no capabilities array at all', () => {
    expect(validateProposals({ ideas: [] }, KEYS, { max: 3 }).dropped).toEqual(['no capabilities array in the answer']);
    expect(validateProposals(null, KEYS, { max: 3 }).admitted).toEqual([]);
  });
});

describe('scoreCapability', () => {
  it('scores a data source above a tool on identical evidence — the bias, as a number', () => {
    const src = scoreCapability({ kind: 'data_source', cites: 1, recurrence: 1 });
    const tool = scoreCapability({ kind: 'tool', cites: 1, recurrence: 1 });
    expect(src.score).toBeGreaterThan(tool.score);
  });

  it('lets a single-citation data source reach the briefing and holds a single-citation tool back', () => {
    expect(scoreCapability({ kind: 'data_source', cites: 1, recurrence: 1 }).score).toBeGreaterThanOrEqual(
      MIN_BRIDGE_SCORE,
    );
    expect(scoreCapability({ kind: 'tool', cites: 1, recurrence: 1 }).score).toBeLessThan(MIN_BRIDGE_SCORE);
  });

  it('rises with evidence and with persistence across nights', () => {
    const one = scoreCapability({ kind: 'feature', cites: 1, recurrence: 1 }).score;
    const three = scoreCapability({ kind: 'feature', cites: 3, recurrence: 1 }).score;
    const repeated = scoreCapability({ kind: 'feature', cites: 1, recurrence: 4 }).score;
    expect(three).toBeGreaterThan(one);
    expect(repeated).toBeGreaterThan(one);
  });

  it('caps both evidence and persistence so one input cannot run away', () => {
    const a = scoreCapability({ kind: 'feature', cites: 3, recurrence: 4 }).score;
    const b = scoreCapability({ kind: 'feature', cites: 40, recurrence: 400 }).score;
    expect(b).toBe(a);
  });

  it('stays inside 0..1 and names every component', () => {
    const s = scoreCapability({ kind: 'data_source', cites: 99, recurrence: 99 });
    expect(s.score).toBeLessThanOrEqual(1);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(Object.keys(s.components).sort()).toEqual(['base', 'dataGain', 'evidence', 'persistence']);
  });
});

describe('lanes and slugs', () => {
  it('counts sources, feeds and watches as bringing new data — and tools and features not', () => {
    expect(bringsNewData('data_source')).toBe(true);
    expect(bringsNewData('news_source')).toBe(true);
    expect(bringsNewData('watch')).toBe(true);
    expect(bringsNewData('tool')).toBe(false);
    expect(bringsNewData('feature')).toBe(false);
  });

  it('sends a news source down the repo lane, because the source list is code', () => {
    expect(laneFor('news_source')).toBe('feature');
    expect(laneFor('data_source')).toBe('source');
    expect(laneFor('watch')).toBe('watch');
    expect(laneFor('tool')).toBe('tool');
  });

  it('makes the same idea the same slug on every night, and different kinds different rows', () => {
    expect(slugForCapability('data_source', 'Rail disruption feed!')).toBe(
      slugForCapability('data_source', 'rail  disruption   feed'),
    );
    expect(slugForCapability('watch', 'Rail disruption feed')).not.toBe(
      slugForCapability('data_source', 'Rail disruption feed'),
    );
  });
});
