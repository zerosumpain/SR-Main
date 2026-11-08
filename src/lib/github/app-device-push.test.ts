import { describe, expect, it } from 'vitest';
import { buildPushMessage, livePins, readPins, withPin, type DevicePin } from './app-device-push';
import type { ReleaseEntry } from './app-release';

const pin = (build: number, at: string): DevicePin => ({ build, commit: null, at, by: 'owner@example.test', push: 'sent' });
const entry = (build: number, at: string, kind: ReleaseEntry['kind']): ReleaseEntry => ({ build, commit: null, at, by: null, kind });

describe('a build sent to one phone', () => {
  it('reads a stored record leniently: anything malformed is no pin', () => {
    expect(
      readPins({
        'cred-1': { build: 131, commit: 'a'.repeat(40), at: '2026-10-21T10:00:00Z', by: 'o', push: 'sent' },
        'cred-2': { build: 0, at: '2026-10-21T10:00:00Z' },
        'cred-3': { build: 132 },
        'cred-4': 'nonsense',
      }),
    ).toEqual({ 'cred-1': { build: 131, commit: 'a'.repeat(40), at: '2026-10-21T10:00:00Z', by: 'o', push: 'sent' } });
    expect(readPins(null)).toEqual({});
    expect(readPins([1, 2])).toEqual({});
  });

  it('holds until the owner releases a build to the family after it', () => {
    const pins = { early: pin(131, '2026-10-21T09:00:00Z'), late: pin(133, '2026-10-21T11:00:00Z') };
    const history = [entry(132, '2026-10-21T10:00:00Z', 'release'), entry(131, '2026-10-20T10:00:00Z', 'pinned')];
    expect(Object.keys(livePins(pins, { history }))).toEqual(['late']);
  });

  it('is not ended by the release the site pinned itself, or by no release at all', () => {
    const pins = { a: pin(131, '2026-10-21T09:00:00Z') };
    expect(livePins(pins, { history: [entry(131, '2026-10-21T10:00:00Z', 'pinned')] })).toEqual(pins);
    expect(livePins(pins, null)).toEqual(pins);
  });

  it('replaces one phone’s pin, or removes it, leaving the others', () => {
    const pins = { a: pin(131, 'x'), b: pin(132, 'y') };
    expect(withPin(pins, 'a', pin(133, 'z')).a.build).toBe(133);
    expect(Object.keys(withPin(pins, 'a', null))).toEqual(['b']);
    expect(Object.keys(pins)).toEqual(['a', 'b']);
  });

  it('pushes a banner that names no person, and that a later send replaces', () => {
    const m = buildPushMessage(133, '0.1.133');
    expect(m.title).toBe('SR 0.1.133 is ready');
    expect(m.category).toBe('app-update');
    expect(m.collapseId).toBe('app-update');
    expect(m.userInfo).toEqual({ category: 'app-update', build: 133 });
  });
});
