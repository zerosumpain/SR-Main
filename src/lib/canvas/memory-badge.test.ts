import { describe, it, expect } from 'vitest';
import { memoryBadgeFor } from './memory-badge';

describe('memoryBadgeFor', () => {
  it('badges a dedupe node with its configured store key', () => {
    expect(memoryBadgeFor({ type: 'dedupe', config: { storeKey: 'seen_urls' } })).toBe(
      '⌘ remembers seen_urls',
    );
  });

  it('defaults the dedupe key to seen_ids when unset', () => {
    expect(memoryBadgeFor({ type: 'dedupe', config: {} })).toBe('⌘ remembers seen_ids');
    expect(memoryBadgeFor({ type: 'dedupe' })).toBe('⌘ remembers seen_ids');
  });

  it('badges a data-store node with its key', () => {
    expect(memoryBadgeFor({ type: 'data-store', config: { key: 'last_sent' } })).toBe(
      '⌘ remembers last_sent',
    );
  });

  it('returns null for a data-store node with no key', () => {
    expect(memoryBadgeFor({ type: 'data-store', config: {} })).toBeNull();
    expect(memoryBadgeFor({ type: 'data-store', config: { key: '   ' } })).toBeNull();
  });

  it('badges a whatsapp node only while duplicate suppression is on', () => {
    expect(memoryBadgeFor({ type: 'whatsapp', config: { suppressDuplicateWindowMins: 1440 } })).toBe(
      '⌘ remembers _wa_sent_hashes',
    );
    expect(memoryBadgeFor({ type: 'whatsapp', config: { suppressDuplicateWindowMins: 0 } })).toBeNull();
  });

  it('returns null for non-memory node types and nullish input', () => {
    expect(memoryBadgeFor({ type: 'llm-call', config: { key: 'x' } })).toBeNull();
    expect(memoryBadgeFor({ type: 'tavily-search' })).toBeNull();
    expect(memoryBadgeFor(null)).toBeNull();
    expect(memoryBadgeFor(undefined)).toBeNull();
  });

  it('shows a templated data-store key verbatim', () => {
    expect(memoryBadgeFor({ type: 'data-store', config: { key: 'digest_{{today}}' } })).toBe(
      '⌘ remembers digest_{{today}}',
    );
  });
});
