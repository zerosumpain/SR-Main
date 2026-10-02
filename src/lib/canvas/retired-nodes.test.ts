import { describe, expect, it } from 'vitest';
import { allTypes, byType } from './adapter';
import { nodeDefinitions } from '$lib/workflows/registry-client';
import { isDisplayOnlyType } from '$lib/workflows/types';

/**
 * SR-Workflows owns workflow execution and refuses graphs holding these types
 * (its src/lib/workflows/retired-nodes.ts, origin/master 2026-10-02). Main's
 * palette and client registry no longer offer them. Exceptions that Main still
 * uses stay: the Research Desk's live nodes and `stealth-scrape`, whose
 * executor serves /api/scraper/node.
 */
const RETIRED = [
  'stealth-scrape-llm', 'site-mapper', 'interactive-step', 'web-scrape',
  'deep-dive', 'deep-dive-start', 'deep-dive-status', 'deep-dive-report', 'deep-dive-list', 'deep-dive-control',
  'deep-research', 'quick-answer', 'research-result', 'research-search', 'intelligence', 'gmail-trigger',
];

describe('retired workflow node types', () => {
  it('are neither registered nor offered in the palette', () => {
    const registered = new Set(nodeDefinitions.map((d) => d.type));
    const offered = new Set(allTypes().map((t) => t.type));
    expect(RETIRED.filter((t) => registered.has(t))).toEqual([]);
    expect(RETIRED.filter((t) => offered.has(t))).toEqual([]);
  });

  it('keeps the Research Desk palette and stealth-scrape', () => {
    for (const t of ['research-chat', 'research-report', 'webpage']) expect(byType(t), t).toBeDefined();
    expect(byType('research-chat')?.kind).toBe('research-chat');
    expect(byType('research-report')?.kind).toBe('research-report');
    expect(byType('webpage')?.kind).toBe('webpage');
    expect(nodeDefinitions.some((d) => d.type === 'stealth-scrape')).toBe(true);
  });

  it('leaves every registered, user-addable node with a palette entry', () => {
    const missing = nodeDefinitions
      .filter((d) => !d.hidden && !isDisplayOnlyType(d.type) && d.type !== 'switch')
      .map((d) => d.type)
      .filter((t) => !byType(t));
    expect(missing).toEqual([]);
  });
});
