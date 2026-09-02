import { describe, expect, it } from 'vitest';
import { cleanNewsArticleText, summarizeArticleText } from './reader';

describe('news reader cleanup', () => {
  it('removes a leading publisher dateline without removing the article', () => {
    const text = [
      'Sep 02, 2026 |',
      'Our newest models deliver next-generation intelligence for agentic workflows and cybersecurity.',
      'Raluca Ada Popa',
    ].join('\n\n');
    expect(cleanNewsArticleText(text, 'A model announcement')).toBe(
      'Our newest models deliver next-generation intelligence for agentic workflows and cybersecurity.\n\nRaluca Ada Popa',
    );
  });

  it('summarises substantive paragraphs without splitting on version numbers', () => {
    const text = [
      'Published 2 September 2026',
      'Our newest models deliver next-generation intelligence for agentic workflows and cybersecurity.',
      'Building on the momentum of 3.7 Flash, this release improves reasoning while keeping latency low.',
    ].join('\n\n');
    expect(summarizeArticleText('Gemini 3.8 Flash', text)).toBe(
      'Our newest models deliver next-generation intelligence for agentic workflows and cybersecurity. Building on the momentum of 3.7 Flash, this release improves reasoning while keeping latency low.',
    );
  });
});
