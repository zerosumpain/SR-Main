import { describe, expect, it } from 'vitest';
import {
  canChooseOutput,
  canRequestMic,
  micStateNote,
  micPermissionStatus,
  outputLabel,
  readMicPermission,
  unblockHint,
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

describe('unblockHint', () => {
  it('names the address-bar control for Chromium, Edge and Firefox', () => {
    expect(unblockHint('Mozilla/5.0 Chrome/120 Safari/537.36')).toMatch(/address bar/i);
    expect(unblockHint('Mozilla/5.0 Chrome/120 Edg/120')).toMatch(/address bar/i);
    expect(unblockHint('Mozilla/5.0 Firefox/121.0')).toMatch(/permissions icon/i);
  });

  it('sends Safari to the right menu, and is not fooled by Chrome saying "Safari"', () => {
    // Every Chromium UA string contains "Safari"; order of the checks is what
    // keeps a Chrome user from being told to open a Safari menu.
    expect(unblockHint('Mozilla/5.0 Version/17.0 Safari/605.1.15')).toMatch(/Settings for This Website/);
    expect(unblockHint('Mozilla/5.0 Chrome/120 Safari/537.36')).not.toMatch(/Settings for This Website/);
  });

  it('still says something useful for an unknown browser', () => {
    expect(unblockHint('')).toMatch(/site settings|address bar/i);
  });
});

describe('micStateNote', () => {
  it('carries the browser-specific unblock instruction when denied', () => {
    expect(micStateNote('denied', 'Mozilla/5.0 Firefox/121.0')).toMatch(/permissions icon/i);
  });
});

describe('micPermissionStatus', () => {
  it('returns the live status object so the page can watch for a change', async () => {
    // This is what makes unblocking take effect without a reload.
    const status = { state: 'denied', addEventListener() {} };
    const nav = { mediaDevices: {}, permissions: { query: async () => status } };
    const out = await micPermissionStatus(nav, true);
    expect(out.state).toBe('denied');
    expect(out.status).toBe(status);
  });

  it('returns a null status when the browser gives no event target', async () => {
    const nav = { mediaDevices: {}, permissions: { query: async () => ({ state: 'granted' }) } };
    const out = await micPermissionStatus(nav, true);
    expect(out.state).toBe('granted');
    expect(out.status).toBeNull();
  });

  it('is insecure-first, before it looks at permissions at all', async () => {
    const nav = { mediaDevices: {}, permissions: { query: async () => ({ state: 'granted' }) } };
    await expect(micPermissionStatus(nav, false)).resolves.toEqual({ state: 'insecure', status: null });
  });
});
