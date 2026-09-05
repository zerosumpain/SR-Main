import { describe, expect, it } from 'vitest';
import {
  canChooseOutput,
  canRequestMic,
  micStateNote,
  outputLabel,
  readMicPermission,
} from './audio-access';

describe('canRequestMic', () => {
  const nav = { mediaDevices: { getUserMedia: () => {} } };

  it('is false on an insecure origin even when the API looks present', () => {
    // homeserv over http://192.168.x.x — the call rejects before any prompt,
    // which reads as a denial and is not one.
    expect(canRequestMic(nav, false)).toBe(false);
  });

  it('is false when mediaDevices is missing entirely', () => {
    expect(canRequestMic({}, true)).toBe(false);
    expect(canRequestMic(undefined, true)).toBe(false);
  });

  it('is true on a secure origin with the API present', () => {
    expect(canRequestMic(nav, true)).toBe(true);
  });
});

describe('canChooseOutput', () => {
  it('is true only where selectAudioOutput exists', () => {
    expect(canChooseOutput({ mediaDevices: { selectAudioOutput: () => {} } })).toBe(true);
    expect(canChooseOutput({ mediaDevices: {} })).toBe(false);
    expect(canChooseOutput(undefined)).toBe(false);
  });
});

describe('outputLabel', () => {
  it('names a device when the browser gives a label', () => {
    expect(outputLabel({ deviceId: 'abc', label: 'Studio Monitors' })).toBe('Studio Monitors');
  });

  it('falls back without pretending an unlabelled device is the default', () => {
    // Labels are empty until a permission is granted, so an id with no label is
    // still a real choice the user made.
    expect(outputLabel({ deviceId: 'abc', label: '' })).toBe('Selected output');
    expect(outputLabel({ deviceId: 'default', label: '' })).toBe('System default');
    expect(outputLabel(null)).toBe('System default');
  });
});

describe('readMicPermission', () => {
  it('reports insecure before it reports anything about permissions', () => {
    return expect(readMicPermission({ mediaDevices: {} }, false)).resolves.toBe('insecure');
  });

  it('passes through a real permission state', async () => {
    const nav = {
      mediaDevices: {},
      permissions: { query: async () => ({ state: 'granted' }) },
    };
    await expect(readMicPermission(nav, true)).resolves.toBe('granted');
  });

  it('is "unknown", not a crash, when the Permissions API throws on the name', async () => {
    // Safari throws a TypeError for an unsupported permission name rather than
    // rejecting, so this must be caught synchronously as well as async.
    const nav = {
      mediaDevices: {},
      permissions: {
        query: () => {
          throw new TypeError('unsupported');
        },
      },
    };
    await expect(readMicPermission(nav, true)).resolves.toBe('unknown');
  });

  it('is "unknown" where there is no Permissions API at all', async () => {
    await expect(readMicPermission({ mediaDevices: {} }, true)).resolves.toBe('unknown');
  });
});

describe('micStateNote', () => {
  it('tells the user what to actually do about each state', () => {
    expect(micStateNote('denied')).toMatch(/site settings/i);
    expect(micStateNote('insecure')).toMatch(/https/i);
    expect(micStateNote('granted')).toMatch(/ready/i);
  });
});
