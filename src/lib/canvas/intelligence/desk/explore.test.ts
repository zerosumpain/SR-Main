import { describe, it, expect } from 'vitest';
import { buildExplorePrompt, buildExplorePayload } from './explore';

describe('buildExplorePrompt', () => {
  it('uses the fact content as the snippet for a fact', () => {
    const out = buildExplorePrompt({ kind: 'fact', id: 'f1', content: 'The treaty was signed in 1648.' });
    expect(out).not.toBeNull();
    expect(out!.kind).toBe('fact');
    expect(out!.snippet).toBe('The treaty was signed in 1648.');
    expect(out!.heading).toBe('EXPLORE FURTHER');
  });

  it('uses the entity name as the snippet for an entity', () => {
    const out = buildExplorePrompt({ kind: 'entity', id: 'e1', name: 'Peace of Westphalia' });
    expect(out).not.toBeNull();
    expect(out!.kind).toBe('entity');
    expect(out!.snippet).toBe('Peace of Westphalia');
  });

  it('truncates a long snippet to ~140 chars with an ellipsis', () => {
    const long = 'x'.repeat(300);
    const out = buildExplorePrompt({ kind: 'fact', id: 'f2', content: long });
    expect(out).not.toBeNull();
    // 140 chars + a single ellipsis char.
    expect(out!.snippet.length).toBeLessThanOrEqual(141);
    expect(out!.snippet.endsWith('…')).toBe(true);
    expect(out!.snippet.startsWith('x'.repeat(140))).toBe(true);
  });

  it('does not truncate a snippet at exactly the limit', () => {
    const exact = 'y'.repeat(140);
    const out = buildExplorePrompt({ kind: 'fact', id: 'f3', content: exact });
    expect(out!.snippet).toBe(exact);
    expect(out!.snippet.endsWith('…')).toBe(false);
  });

  it('returns null for a non-addressable kind (source)', () => {
    expect(buildExplorePrompt({ kind: 'source', id: 's1', title: 'A paper' })).toBeNull();
  });

  it('returns null for a null artefact', () => {
    expect(buildExplorePrompt(null)).toBeNull();
  });

  it('returns null when the addressable field is missing/blank', () => {
    expect(buildExplorePrompt({ kind: 'fact', id: 'f4', content: '   ' })).toBeNull();
    expect(buildExplorePrompt({ kind: 'entity', id: 'e2' })).toBeNull();
  });
});

describe('buildExplorePayload', () => {
  it('omits additionalContext when the note is blank', () => {
    expect(buildExplorePayload('fact', 'f1', '')).toEqual({ type: 'fact', itemId: 'f1' });
    expect(buildExplorePayload('entity', 'e1', '   ')).toEqual({ type: 'entity', itemId: 'e1' });
  });

  it('includes a trimmed additionalContext when the note is present', () => {
    expect(buildExplorePayload('fact', 'f1', '  focus on the economics  ')).toEqual({
      type: 'fact',
      itemId: 'f1',
      additionalContext: 'focus on the economics',
    });
  });
});
