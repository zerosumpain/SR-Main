import { describe, expect, it } from 'vitest';
import { deliveryReport } from './report';

describe('deliveryReport', () => {
  it('names both channels when both went', () => {
    expect(deliveryReport({ raised: true, id: 'a', whatsapp: true, routed: { whatsapp: true, native: true } })).toMatchObject({
      whatsapp: 'sent',
      iphone: 'queued',
      channels: 'WhatsApp + iPhone',
    });
  });

  it('says a routed WhatsApp send failed rather than hiding it', () => {
    expect(deliveryReport({ raised: true, id: 'a', whatsapp: false, routed: { whatsapp: true, native: true } })).toMatchObject({
      whatsapp: 'failed',
      channels: 'WhatsApp (failed) + iPhone',
    });
  });

  it('reports a phone-only category as iPhone', () => {
    expect(deliveryReport({ raised: true, id: 'a', whatsapp: false, routed: { whatsapp: false, native: true } }).channels).toBe('iPhone');
  });

  it('reports suppression with its reason', () => {
    expect(deliveryReport({ raised: false, reason: 'duplicate' })).toMatchObject({
      raised: false,
      whatsapp: 'off',
      iphone: 'off',
      channels: 'suppressed (duplicate)',
    });
  });
});
