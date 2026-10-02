import { describe, expect, it } from 'vitest';
import { allTypes, byType, mapTypeToKind } from './adapter';

/**
 * SR-Workflows owns workflow node types, their registry and the canvas palette
 * (Main's copies were deleted on 2026-10-02). Main's palette is the Research
 * Desk's: exactly its three live nodes, and no workflow node, retired or not.
 */
const RETIRED = [
  'stealth-scrape', 'stealth-scrape-llm', 'site-mapper', 'interactive-step', 'web-scrape',
  'deep-dive', 'deep-dive-start', 'deep-dive-status', 'deep-dive-report', 'deep-dive-list', 'deep-dive-control',
  'deep-research', 'quick-answer', 'research-result', 'research-search', 'intelligence', 'gmail-trigger',
];

describe('the Research Desk palette', () => {
  it('offers exactly the three desk nodes', () => {
    expect(allTypes().map((t) => t.type).sort()).toEqual(['research-chat', 'research-report', 'webpage']);
    for (const t of allTypes()) expect(mapTypeToKind(t.type)).toBe(t.kind);
  });

  it('offers no workflow node type', () => {
    for (const t of [...RETIRED, 'llm-call', 'transform', 'trigger', 'http-request']) expect(byType(t), t).toBeUndefined();
  });
});
