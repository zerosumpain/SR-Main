import { describe, it, expect } from 'vitest';
import { capabilityToCandidate } from './bridge';
import { MIN_BRIDGE_SCORE } from './spec';

const row = {
  slug: 'data_source:rail-disruption-feed',
  kind: 'data_source' as const,
  title: 'Rail disruption feed for the Norwich line',
  need: 'Nothing here knows when a train is cancelled.',
  value: 'The morning briefing could say the 07:12 is off before he leaves.',
  consumer: 'shared',
  cites: ['q:0', 'intent:1'],
  score: 0.7,
  components: { base: 0.25, evidence: 0.24, dataGain: 0.18, persistence: 0 },
  recurrence: 1,
};

describe('capabilityToCandidate', () => {
  it('gives each kind its own thought kind, so weights are learned per lane', () => {
    expect(capabilityToCandidate(row)?.kind).toBe('capability_data_source');
    expect(capabilityToCandidate({ ...row, kind: 'watch' })?.kind).toBe('capability_watch');
  });

  it('leads the title with what the lead is', () => {
    expect(capabilityToCandidate(row)?.title).toBe('New source: Rail disruption feed for the Norwich line');
    expect(capabilityToCandidate({ ...row, kind: 'news_source' })?.title).toContain('New feed:');
  });

  it('explains from recorded fields only, and states how much evidence it had', () => {
    const c = capabilityToCandidate(row);
    expect(c?.explanation).toContain(row.need);
    expect(c?.explanation).toContain(row.value);
    expect(c?.explanation).toContain('Cited 2 lines of evidence');
    expect(c?.explanation).not.toContain('separate nights');
  });

  it('mentions persistence only once there is any', () => {
    expect(capabilityToCandidate({ ...row, recurrence: 3 })?.explanation).toContain('3 separate nights');
  });

  it('holds anything under the bridge bar on the ledger', () => {
    expect(capabilityToCandidate({ ...row, score: MIN_BRIDGE_SCORE - 0.01 })).toBeNull();
    expect(capabilityToCandidate({ ...row, score: MIN_BRIDGE_SCORE })).not.toBeNull();
  });

  it('refuses a row missing its own words rather than emitting a blank card', () => {
    expect(capabilityToCandidate({ ...row, need: '' })).toBeNull();
    expect(capabilityToCandidate({ ...row, title: '   ' })).toBeNull();
  });

  it('carries the ledger identity as the dedupe key, so a re-proposal updates one thought', () => {
    expect(capabilityToCandidate(row)?.dedupeKey).toBe(`capability:${row.slug}`);
  });

  it('cites the ledger row and every pack key it survived with', () => {
    const ev = capabilityToCandidate(row)?.evidence ?? [];
    expect(ev[0]).toMatchObject({ kind: 'capability', id: row.slug });
    expect(ev.filter((e) => e.kind === 'appetite').map((e) => e.id)).toEqual(row.cites);
  });

  it('keeps the score inside 0..1 whatever the ledger holds', () => {
    expect(capabilityToCandidate({ ...row, score: 4 })?.rawScore).toBe(1);
  });
});
