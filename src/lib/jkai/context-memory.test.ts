import { describe, expect, it } from 'vitest';
import { deriveContextProposals } from './context-memory';

const now = new Date('2026-08-25T09:00:00.000Z');

describe('context memory proposals', () => {
  it('creates a provisional, provenance-labelled journey suggestion from email, location and weather clues', () => {
    const proposals = deriveContextProposals([
      { source: 'email', status: 'ok', summary: 'Dentist appointment confirmation', evidenceRef: 'email:abc', data: { title: 'Dentist appointment confirmation' } },
      { source: 'location', status: 'ok', evidenceRef: 'location:current', data: { away: true } },
      { source: 'weather', status: 'ok', evidenceRef: 'weather:current', data: { factors: ['Rain likely (80%)'] } },
    ], [], {}, now);

    const journey = proposals.find((proposal) => proposal.text.includes('journey'));
    expect(journey).toMatchObject({ kind: 'suggestion', provisional: true, confirmed: false, confidence: 0.8 });
    expect(journey?.provenance.map((item) => item.label)).toEqual([
      'from current location context',
      'based on current weather near your location',
    ]);
    expect(proposals.find((proposal) => proposal.temporalScope === 'upcoming')?.provenance[0]).toMatchObject({
      label: 'from a recent email', reference: 'email:abc',
    });
  });

  it('distinguishes an explicit chat fact from an inferred proposal', () => {
    const proposals = deriveContextProposals([
      { source: 'chat', status: 'ok', summary: 'I prefer vegetarian meals.' },
      { source: 'location', status: 'ok', data: { away: true } },
      { source: 'weather', status: 'ok', summary: 'Fog likely' },
    ], [], {}, now);

    expect(proposals[0]).toMatchObject({ kind: 'memory', confirmed: true, provisional: false, confidence: 0.95 });
    expect(proposals.find((proposal) => proposal.kind === 'suggestion')).toMatchObject({ provisional: true, confirmed: false });
  });

  it('omits failed sources rather than inventing a fact', () => {
    expect(deriveContextProposals([
      { source: 'location', status: 'failed', data: { away: true } },
      { source: 'weather', status: 'ok', summary: 'Rain likely' },
    ], [], {}, now)).toEqual([]);
  });

  it('does not resurface a non-expired dismissed item and rate limits suggestions', () => {
    const clues = [
      { source: 'location' as const, status: 'ok' as const, data: { away: true } },
      { source: 'weather' as const, status: 'ok' as const, summary: 'Rain likely' },
      { source: 'email' as const, status: 'ok' as const, summary: 'Meeting booking', data: { title: 'Meeting booking' } },
    ];
    const initial = deriveContextProposals(clues, [], { maxSuggestionsPerTurn: 1 }, now);
    expect(initial).toHaveLength(1);
    const hidden = deriveContextProposals(clues, [{
      fingerprint: initial[0].fingerprint, status: 'dismissed', updatedAt: now, expiresAt: new Date(now.getTime() + 1_000),
    }], {}, now);
    expect(hidden.find((proposal) => proposal.fingerprint === initial[0].fingerprint)).toBeUndefined();
  });

  it('allows expired candidates to be reconsidered and does not retain private body text', () => {
    const proposals = deriveContextProposals([
      { source: 'email', status: 'ok', summary: 'Booking confirmation', evidenceRef: 'email:abc', data: { title: 'Booking confirmation', body: 'private body text must not be persisted' } },
    ], [{ fingerprint: 'suggestion_x', status: 'dismissed', updatedAt: now, expiresAt: new Date(now.getTime() - 1) }], {}, now);
    expect(JSON.stringify(proposals)).not.toContain('private body text');
    expect(proposals[0].expiresAt.getTime()).toBeGreaterThan(now.getTime());
  });
});
