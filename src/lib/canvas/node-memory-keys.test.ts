import { describe, it, expect } from 'vitest';
import { memoryKeysFor, sharedMemoryKeyWarning } from './node-memory-keys';

describe('memoryKeysFor', () => {
  it('resolves the dedupe seen-set key, defaulting to seen_ids', () => {
    expect(memoryKeysFor({ type: 'dedupe', config: { storeKey: 'seen_urls' } })).toEqual([
      'seen_urls',
    ]);
    expect(memoryKeysFor({ type: 'dedupe', config: {} })).toEqual(['seen_ids']);
    expect(memoryKeysFor({ type: 'dedupe', config: { storeKey: '  ' } })).toEqual(['seen_ids']);
  });

  it('resolves the data-store key, or nothing when unset', () => {
    expect(memoryKeysFor({ type: 'data-store', config: { key: 'last_sent' } })).toEqual([
      'last_sent',
    ]);
    expect(memoryKeysFor({ type: 'data-store', config: {} })).toEqual([]);
  });

  it('returns a templated key verbatim rather than guessing at it', () => {
    expect(memoryKeysFor({ type: 'data-store', config: { key: 'cursor_{{input.id}}' } })).toEqual([
      'cursor_{{input.id}}',
    ]);
  });

  it('surfaces the WhatsApp hash buffer only while suppression is on', () => {
    expect(
      memoryKeysFor({ type: 'whatsapp', config: { suppressDuplicateWindowMins: 1440 } }),
    ).toEqual(['_wa_sent_hashes']);
    expect(memoryKeysFor({ type: 'whatsapp', config: { suppressDuplicateWindowMins: 0 } })).toEqual(
      [],
    );
    expect(memoryKeysFor({ type: 'whatsapp', config: {} })).toEqual([]);
  });

  it('returns nothing for stateless node types and nullish input', () => {
    expect(memoryKeysFor({ type: 'accumulator', config: { key: 'x' } })).toEqual([]);
    expect(memoryKeysFor({ type: 'conditional' })).toEqual([]);
    expect(memoryKeysFor(null)).toEqual([]);
    expect(memoryKeysFor(undefined)).toEqual([]);
  });
});

describe('sharedMemoryKeyWarning', () => {
  it('warns on keys read outside the workflow engine', () => {
    expect(sharedMemoryKeyWarning('family_presence_states')).toMatch(/family-presence/);
  });

  it('stays quiet for ordinary keys, including Object.prototype names', () => {
    expect(sharedMemoryKeyWarning('seen_ids')).toBeNull();
    expect(sharedMemoryKeyWarning('constructor')).toBeNull();
    expect(sharedMemoryKeyWarning('toString')).toBeNull();
  });
});
