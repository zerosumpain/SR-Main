// src/lib/canvas/intelligence/desk/feedFormatter.test.ts
import { describe, it, expect } from 'vitest';
import { formatFeedEvent, formatLogFeedEvent } from './feedFormatter';

describe('formatFeedEvent — source', () => {
  it('formats with domain + credibilityScore', () => {
    const r = formatFeedEvent('source', { domain: 'bbc.co.uk', credibilityScore: 0.9 });
    expect(r).not.toBeNull();
    expect(r!.text).toBe('+ src bbc.co.uk · 0.9');
    expect(r!.tone).toBe('source');
  });

  it('falls back to credibilityType when score is null', () => {
    const r = formatFeedEvent('source', { domain: 'example.com', credibilityScore: null, credibilityType: 'news' });
    expect(r!.text).toBe('+ src example.com · news');
  });

  it('handles missing domain gracefully', () => {
    const r = formatFeedEvent('source', {});
    expect(r!.text).toBe('+ src ?');
    expect(r!.tone).toBe('source');
  });

  it('omits qualifier when both score and type are absent', () => {
    const r = formatFeedEvent('source', { domain: 'gov.uk' });
    expect(r!.text).toBe('+ src gov.uk');
  });
});

describe('formatFeedEvent — fact', () => {
  it('formats a regular fact with confidence', () => {
    const r = formatFeedEvent('fact', { confidence: 0.85, isCounterfactual: false });
    expect(r!.text).toBe('+ fact · 0.85');
    expect(r!.tone).toBe('fact');
  });

  it('formats a fact without confidence', () => {
    const r = formatFeedEvent('fact', {});
    expect(r!.text).toBe('+ fact');
    expect(r!.tone).toBe('fact');
  });

  it('formats a counterfactual with challenge tone', () => {
    const r = formatFeedEvent('fact', { isCounterfactual: true, confidence: 0.6 });
    expect(r!.text).toBe('⚠ counter · 0.6');
    expect(r!.tone).toBe('challenge');
  });

  it('counterfactual without confidence', () => {
    const r = formatFeedEvent('fact', { isCounterfactual: true });
    expect(r!.text).toBe('⚠ counter');
    expect(r!.tone).toBe('challenge');
  });
});

describe('formatFeedEvent — entity', () => {
  it('formats entity with name and type', () => {
    const r = formatFeedEvent('entity', { name: 'Julius Caesar', type: 'person' });
    expect(r!.text).toBe('✓ Julius Caesar · person');
    expect(r!.tone).toBe('entity');
  });

  it('handles missing name gracefully', () => {
    const r = formatFeedEvent('entity', { type: 'org' });
    expect(r!.text).toBe('✓ ? · org');
  });

  it('handles missing type gracefully', () => {
    const r = formatFeedEvent('entity', { name: 'Rome' });
    expect(r!.text).toBe('✓ Rome');
  });
});

describe('formatFeedEvent — relationship', () => {
  it('formats relationship with relationshipType', () => {
    const r = formatFeedEvent('relationship', { relationshipType: 'ally_of' });
    expect(r!.text).toBe('~ ally_of');
    expect(r!.tone).toBe('link');
  });

  it('handles missing relationshipType gracefully', () => {
    const r = formatFeedEvent('relationship', {});
    expect(r!.text).toBe('~ ?');
    expect(r!.tone).toBe('link');
  });
});

describe('formatFeedEvent — unknown type', () => {
  it('returns null for unknown artefact types', () => {
    expect(formatFeedEvent('unknown_type', {})).toBeNull();
    expect(formatFeedEvent('', {})).toBeNull();
  });
});

describe('formatLogFeedEvent', () => {
  it('strips leading emoji + whitespace (emitLog style)', () => {
    const r = formatLogFeedEvent('🔍  Searching: roman republic fall causes');
    expect(r.text).toBe('Searching: roman republic fall causes');
    expect(r.tone).toBe('log');
  });

  it('handles plain text without icons', () => {
    const r = formatLogFeedEvent('Research complete!');
    expect(r.text).toBe('Research complete!');
  });

  it('collapses internal whitespace', () => {
    const r = formatLogFeedEvent('⚠️   Phase 2   error:   timeout  ');
    expect(r.text).toBe('Phase 2 error: timeout');
  });

  it('returns ellipsis for empty/icon-only message', () => {
    const r = formatLogFeedEvent('🔍');
    expect(r.text).toBe('…');
  });

  it('tone is always "log"', () => {
    expect(formatLogFeedEvent('anything').tone).toBe('log');
  });
});
