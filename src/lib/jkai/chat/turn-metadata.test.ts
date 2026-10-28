import { describe, it, expect } from 'vitest';
import { assistantTurnMetadata } from './turn-metadata';

describe('assistantTurnMetadata', () => {
  it('stamps the channel always, the memory and soul version when Core sent them', () => {
    expect(assistantTurnMetadata({ memory: null, identityVersion: null }, 'whatsapp')).toEqual({ channel: 'whatsapp' });
    expect(assistantTurnMetadata({ memory: { k: 1 } as never, identityVersion: 'v3:abc' }, 'followup')).toEqual({
      memory: { k: 1 },
      channel: 'followup',
      identityVersion: 'v3:abc',
    });
  });
});
