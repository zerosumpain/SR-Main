// src/lib/deepdive/source-summary-prompt.test.ts
import { describe, it, expect } from 'vitest';
import { buildSourceSummaryPrompt } from './source-summary-prompt';

const baseSource = {
  id: 'src-1',
  url: 'https://example.com/article',
  title: 'Example Article',
  domain: 'example.com',
  snippet: 'An article about things.',
};

describe('buildSourceSummaryPrompt — with facts', () => {
  const facts = [
    { id: 'f1', content: 'The sky is blue.' },
    { id: 'f2', content: 'Water boils at 100°C.' },
  ];

  it('includes the source title', () => {
    const { user } = buildSourceSummaryPrompt(baseSource, facts);
    expect(user).toContain('Example Article');
  });

  it('includes each fact as a numbered bullet', () => {
    const { user } = buildSourceSummaryPrompt(baseSource, facts);
    expect(user).toContain('1. The sky is blue.');
    expect(user).toContain('2. Water boils at 100°C.');
  });

  it('includes the snippet', () => {
    const { user } = buildSourceSummaryPrompt(baseSource, facts);
    expect(user).toContain('An article about things.');
  });

  it('includes the fact count', () => {
    const { user } = buildSourceSummaryPrompt(baseSource, facts);
    expect(user).toContain('Extracted facts (2)');
  });

  it('has a non-empty system prompt', () => {
    const { system } = buildSourceSummaryPrompt(baseSource, facts);
    expect(system.length).toBeGreaterThan(20);
  });
});

describe('buildSourceSummaryPrompt — empty facts path', () => {
  it('returns a graceful fallback in the user prompt', () => {
    const { user } = buildSourceSummaryPrompt(baseSource, []);
    expect(user).toContain('No extracted facts');
    expect(user).toContain('An article about things.');
  });

  it('mentions "insufficient content" or snippet when no snippet', () => {
    const src = { ...baseSource, snippet: null };
    const { user } = buildSourceSummaryPrompt(src, []);
    expect(user).toContain('No snippet available');
  });

  it('falls back to URL when no title', () => {
    const src = { ...baseSource, title: null };
    const { user } = buildSourceSummaryPrompt(src, []);
    expect(user).toContain('https://example.com/article');
  });
});

describe('buildSourceSummaryPrompt — no snippet but has facts', () => {
  it('omits the snippet line cleanly when snippet is null', () => {
    const src = { ...baseSource, snippet: null };
    const facts = [{ id: 'f1', content: 'Some fact.' }];
    const { user } = buildSourceSummaryPrompt(src, facts);
    expect(user).toContain('Some fact.');
    // Should not include "(No snippet available.)" in the facts path
    expect(user).not.toContain('No snippet available');
  });
});
