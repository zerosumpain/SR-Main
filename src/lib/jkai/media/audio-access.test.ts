import { describe, expect, it } from 'vitest';
import {
  canChooseOutput,
  canRequestMic,
  micErrorMessage,
  micPolicyAllowed,
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

describe('micPolicyAllowed', () => {
  it('reports a document-level block, which is what `microphone=()` produces', () => {
    // A Permissions Policy is checked BEFORE the prompt, so this is the state
    // where site settings still read "Ask" and cannot fix anything.
    expect(micPolicyAllowed({ permissionsPolicy: { allowsFeature: () => false } })).toBe(false);
    expect(micPolicyAllowed({ permissionsPolicy: { allowsFeature: () => true } })).toBe(true);
  });

  it('reads the older featurePolicy name too', () => {
    expect(micPolicyAllowed({ featurePolicy: { allowsFeature: () => false } })).toBe(false);
  });

  it('says "cannot tell" rather than "blocked" where the API is absent', () => {
    // Firefox and Safari ship neither name. Guessing "blocked" here would put a
    // false accusation on screen in the browsers that work fine.
    expect(micPolicyAllowed({})).toBe(null);
    expect(micPolicyAllowed(undefined)).toBe(null);
    expect(micPolicyAllowed({ permissionsPolicy: {} })).toBe(null);
  });

  it('does not throw when allowsFeature does', () => {
    expect(
      micPolicyAllowed({
        permissionsPolicy: {
          allowsFeature: () => {
            throw new TypeError('unsupported feature');
          },
        },
      }),
    ).toBe(null);
  });
});

describe('micPermissionStatus with a policy block', () => {
  const nav = {
    mediaDevices: {},
    permissions: { query: async () => ({ state: 'prompt' }) },
  };

  it('reports blocked ahead of the permission state', async () => {
    // The permission genuinely is "prompt" — that is the trap. The document is
    // what refuses, so reporting "prompt" would promise a dialog that never comes.
    const out = await micPermissionStatus(nav, true, {
      permissionsPolicy: { allowsFeature: () => false },
    });
    expect(out.state).toBe('blocked');
  });

  it('is unaffected when the policy allows the feature', async () => {
    const out = await micPermissionStatus(nav, true, {
      permissionsPolicy: { allowsFeature: () => true },
    });
    expect(out.state).toBe('prompt');
  });

  it('still reports insecure first — that is the more basic fault', async () => {
    const out = await micPermissionStatus(nav, false, {
      permissionsPolicy: { allowsFeature: () => false },
    });
    expect(out.state).toBe('insecure');
  });
});

describe('micStateNote for a policy block', () => {
  it('does not send the user to site settings, which cannot fix it', () => {
    const note = micStateNote('blocked');
    expect(note).toMatch(/permissions-policy/i);
    expect(note).not.toMatch(/site settings/i);
  });
});

describe('micErrorMessage', () => {
  const nav = { mediaDevices: { getUserMedia: () => {} } };
  const open = { permissionsPolicy: { allowsFeature: () => true } };
  const shut = { permissionsPolicy: { allowsFeature: () => false } };
  const err = (name: string) => Object.assign(new Error(name), { name });

  it('blames the header, not the reader, when the policy blocks it', () => {
    // The exact fault that shipped: NotAllowedError with the site setting on
    // "Ask". Telling the reader to check site settings here wastes their time.
    const msg = micErrorMessage(err('NotAllowedError'), nav, shut, true);
    expect(msg).toMatch(/permissions-policy/i);
    expect(msg).not.toMatch(/site settings/i);
  });

  it('reports a genuine refusal as a refusal', () => {
    expect(micErrorMessage(err('NotAllowedError'), nav, open, true)).toMatch(/blocked/i);
  });

  it('separates "no device" from "not allowed"', () => {
    expect(micErrorMessage(err('NotFoundError'), nav, open, true)).toMatch(/no microphone found/i);
  });

  it('reports an insecure origin before anything about permissions', () => {
    // http://homeserv — mediaDevices is undefined and the call throws a
    // TypeError, which has nothing to do with permission at all.
    expect(micErrorMessage(err('TypeError'), nav, open, false)).toMatch(/https/i);
  });

  it('still says something useful for an unrecognised failure', () => {
    const msg = micErrorMessage(err('AbortError'), nav, open, true);
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/microphone/i);
  });
});
