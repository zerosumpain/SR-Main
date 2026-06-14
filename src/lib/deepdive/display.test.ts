import { describe, it, expect } from 'vitest';
import {
  confidenceColor,
  confidenceLabel,
  credibilityBadge,
  severityColor,
  ENTITY_TYPE_COLORS,
  SENTIMENT_COLORS,
} from './display';

describe('confidenceColor', () => {
  it('returns green at/above 0.8', () => {
    expect(confidenceColor(0.8)).toBe('#2d7d46');
    expect(confidenceColor(0.95)).toBe('#2d7d46');
  });
  it('returns accent in [0.5, 0.8)', () => {
    expect(confidenceColor(0.5)).toBe('var(--accent)');
    expect(confidenceColor(0.79)).toBe('var(--accent)');
  });
  it('returns red below 0.5', () => {
    expect(confidenceColor(0.49)).toBe('#8b3a1a');
    expect(confidenceColor(0)).toBe('#8b3a1a');
  });
});

describe('confidenceLabel', () => {
  it('labels HIGH/MED/LOW at the same thresholds', () => {
    expect(confidenceLabel(0.8)).toBe('HIGH');
    expect(confidenceLabel(0.5)).toBe('MED');
    expect(confidenceLabel(0.49)).toBe('LOW');
  });
});

describe('credibilityBadge', () => {
  it('maps known credibility types', () => {
    expect(credibilityBadge('academic')).toEqual({ label: 'ACADEMIC', color: '#2d7d46' });
    expect(credibilityBadge('government')).toEqual({ label: 'GOV', color: '#2d7d46' });
    expect(credibilityBadge('major_news')).toEqual({ label: 'MAJOR NEWS', color: '#3a6b8b' });
    expect(credibilityBadge('news')).toEqual({ label: 'NEWS', color: '#3a6b8b' });
    expect(credibilityBadge('wiki')).toEqual({ label: 'WIKI', color: '#8b7a3a' });
    expect(credibilityBadge('blog')).toEqual({ label: 'BLOG', color: 'var(--accent)' });
    expect(credibilityBadge('social')).toEqual({ label: 'SOCIAL', color: '#8b3a1a' });
  });
  it('falls back to OTHER for unknown/null/undefined', () => {
    expect(credibilityBadge('whatever')).toEqual({ label: 'OTHER', color: 'var(--text-muted)' });
    expect(credibilityBadge(null)).toEqual({ label: 'OTHER', color: 'var(--text-muted)' });
    expect(credibilityBadge(undefined)).toEqual({ label: 'OTHER', color: 'var(--text-muted)' });
  });
});

describe('severityColor', () => {
  it('maps high/medium/other', () => {
    expect(severityColor('high')).toBe('#8b3a1a');
    expect(severityColor('medium')).toBe('var(--accent)');
    expect(severityColor('low')).toBe('var(--text-muted)');
    expect(severityColor('')).toBe('var(--text-muted)');
  });
});

describe('colour maps', () => {
  it('entity type colours match the canon, with an other fallback key', () => {
    expect(ENTITY_TYPE_COLORS.person).toBe('#c4570a');
    expect(ENTITY_TYPE_COLORS.organisation).toBe('#2d7d46');
    expect(ENTITY_TYPE_COLORS.location).toBe('#3a6b8b');
    expect(ENTITY_TYPE_COLORS.event).toBe('#7b3a8b');
    expect(ENTITY_TYPE_COLORS.concept).toBe('#8b7a3a');
    expect(ENTITY_TYPE_COLORS.product).toBe('#3a8b7b');
    expect(ENTITY_TYPE_COLORS.other).toBe('#666666');
  });
  it('sentiment colours match the canon', () => {
    expect(SENTIMENT_COLORS.positive).toBe('#2d7d46');
    expect(SENTIMENT_COLORS.negative).toBe('#8b3a1a');
    expect(SENTIMENT_COLORS.neutral).toBe('#999999');
    expect(SENTIMENT_COLORS.contested).toBe('#c4570a');
  });
});
