import { describe, it, expect } from 'vitest';
import { coerceInvokeRequest, coerceTurnEnvelope, messageChannel, messageSource } from './invoke-contract';

// The turn envelope is read here as a receiver: what an older or a newer
// producer sends must cost its bad fields, never the call.
describe('coerceTurnEnvelope', () => {
  it('keeps the well-formed fields', () => {
    expect(
      coerceTurnEnvelope({
        surface: 'ios',
        client: { app: 'SRAppleApp', build: '181' },
        locale: 'en-GB',
        tz: 'Europe/London',
        refs: [{ kind: 'daydream_note', id: 'think_abc123' }],
        capabilities: [],
        requestId: '0f8fad5b-d9cb-469f-a165-70867728950e',
      }),
    ).toEqual({
      surface: 'ios',
      client: { app: 'SRAppleApp', build: '181' },
      locale: 'en-GB',
      tz: 'Europe/London',
      refs: [{ kind: 'daydream_note', id: 'think_abc123' }],
      capabilities: [],
      requestId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    });
  });

  it('takes the device id from the server only, never from the body', () => {
    expect(coerceTurnEnvelope({ client: { deviceId: 'spoofed' } })).toEqual({});
    expect(coerceTurnEnvelope({ client: { deviceId: 'spoofed' } }, { deviceId: 'dev_1' })).toEqual({ client: { deviceId: 'dev_1' } });
  });

  it('tolerates absence and drops what it does not know', () => {
    expect(coerceTurnEnvelope(undefined)).toEqual({});
    expect(coerceTurnEnvelope('web')).toEqual({});
    expect(
      coerceTurnEnvelope({ surface: 'telegram', locale: 'x', tz: 'not a zone', refs: [{ kind: 'secret', id: '1' }, { kind: 'trip', id: 'a b' }], requestId: 'nope' }),
    ).toEqual({});
  });

  it('caps and de-duplicates refs', () => {
    const refs = Array.from({ length: 9 }, (_, i) => ({ kind: 'trip', id: `t${i % 7}` }));
    const out = coerceTurnEnvelope({ refs: [{ kind: 'trip', id: 't0' }, ...refs] });
    expect(out.refs?.map((r) => r.id)).toEqual(['t0', 't1', 't2', 't3', 't4']);
  });
});

describe('the invoke context carries the envelope labels', () => {
  it('reads a known surface and a device id, and drops anything else', () => {
    expect(coerceInvokeRequest({ name: 't', context: { surface: 'whatsapp', deviceId: 'dev_1' } }).context).toEqual({ surface: 'whatsapp', deviceId: 'dev_1' });
    expect(coerceInvokeRequest({ name: 't', context: { surface: 'root', deviceId: '' } }).context).toEqual({});
  });
});

describe('a message label', () => {
  it('reads the stamped channel first, then the thread source', () => {
    expect(messageSource({ channel: 'web' }, 'whatsapp')).toBe('web');
    expect(messageSource(null, 'whatsapp')).toBe('whatsapp');
    expect(messageChannel({ channel: 'ios' }, 'web')).toBe('ios');
    expect(messageChannel(undefined, 'app')).toBe('ios');
    expect(messageChannel({ channel: 'bogus' }, null)).toBe('web');
  });
});
