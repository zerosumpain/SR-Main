import { describe, expect, it } from 'vitest';
import { phoneTelemetry } from './native-telemetry';

// The grammar is shared with the companion pilot (server/telemetry.mjs) and
// these cases mirror its test: a change to one that the other does not make
// shows up as the two lanes describing the same phone differently.

const h = (o: Record<string, string>) => new Headers(o);

describe('phoneTelemetry', () => {
  it('is null for an app that says nothing, or nothing well-formed', () => {
    expect(phoneTelemetry(h({}))).toBeNull();
    expect(phoneTelemetry(h({ 'X-SR-App': 'garbage' }))).toBeNull();
  });

  it('reads both headers', () => {
    expect(phoneTelemetry(h({ 'X-SR-App': '0.1.136/136/68136470abcd', 'X-SR-Device': 'iPhone15,2/26.0.1/Rory%27s%20iPhone' }))).toEqual({
      appVersion: '0.1.136',
      appBuild: 136,
      appCommit: '68136470abcd',
      deviceModel: 'iPhone15,2',
      osVersion: '26.0.1',
      deviceName: "Rory's iPhone",
    });
  });

  it('keeps each field on its own: an Xcode build has no commit', () => {
    expect(phoneTelemetry(h({ 'X-SR-App': '0.1.136/136/' }))).toEqual({
      appVersion: '0.1.136',
      appBuild: 136,
      appCommit: null,
      deviceModel: null,
      osVersion: null,
      deviceName: null,
    });
  });

  it('bounds what it stores — this is a label written by whoever holds a device token', () => {
    expect(phoneTelemetry(h({ 'X-SR-App': '1/99999999999/abcdef1' }))?.appBuild).toBeNull();
    expect(phoneTelemetry(h({ 'X-SR-App': '1/-3/abcdef1' }))?.appBuild).toBeNull();
    expect(phoneTelemetry(h({ 'X-SR-App': '1/3/notacommit' }))?.appCommit).toBeNull();
    expect(phoneTelemetry(h({ 'X-SR-Device': 'not a model/26.1' }))?.deviceModel).toBeNull();
    expect(phoneTelemetry(h({ 'X-SR-Device': `iPhone15,2/26.1/${encodeURIComponent('x'.repeat(61))}` }))?.deviceName).toBeNull();
    expect(phoneTelemetry(h({ 'X-SR-Device': 'iPhone15,2/26.1/%E0%A4%A' }))?.deviceName).toBeNull();
    expect(phoneTelemetry(h({ 'X-SR-Device': 'iPhone15,2/26.1/a%00b%0Ac' }))?.deviceName).toBe('abc');
  });

  it('lets a slash through the name once encoded', () => {
    expect(phoneTelemetry(h({ 'X-SR-Device': 'iPad13,16/18.6/A%2FB' }))?.deviceName).toBe('A/B');
  });
});
