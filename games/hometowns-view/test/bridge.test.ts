// The bridge, version 1 (spec §10.9), against a mock app: what the page
// posts carries its version, what the app hands in is checked before use,
// and the reload debounce of A39 holds.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanLens, cleanOps, cleanPoint, cleanTool, inApp, listen, post, requestReload, resetReloadMemo, RELOAD_GAP_MS } from '../src/bridge/bridge';
import { BRIDGE_VERSION, type Posted } from '../src/bridge/protocol';

type Handlers = { webkit?: { messageHandlers?: Record<string, { postMessage(m: unknown): void }> } };

describe('posting to the app', () => {
  const sent: unknown[] = [];
  beforeEach(() => {
    sent.length = 0;
    (globalThis as Handlers).webkit = { messageHandlers: { hometowns: { postMessage: (m) => sent.push(m) } } };
  });
  afterEach(() => {
    delete (globalThis as Handlers).webkit;
    listen(null);
  });

  it('knows it is in the app, and stamps every message with the bridge version', () => {
    expect(inApp()).toBe(true);
    post({ type: 'ready', bridge: BRIDGE_VERSION, engineHash: 'e', paramsHash: 'p' });
    expect(sent).toEqual([{ type: 'ready', bridge: 1, engineHash: 'e', paramsHash: 'p', v: 1 }]);
  });

  it('also tells a local listener (harness mode), and never throws without an app', () => {
    const local: Posted[] = [];
    listen((m) => local.push(m));
    delete (globalThis as Handlers).webkit;
    expect(inApp()).toBe(false);
    expect(() => post({ type: 'haptic', kind: 'tap' })).not.toThrow();
    expect(local).toEqual([{ type: 'haptic', kind: 'tap', v: 1 }]);
  });

  it('allows another page version at most once a minute, and never back to one it left (A39)', () => {
    resetReloadMemo();
    expect(requestReload('aaa', 'bbb', 1_000_000)).toBe(true);
    expect(requestReload('aaa', 'ccc', 1_000_000 + 5_000)).toBe(false);
    expect(requestReload('bbb', 'aaa', 1_000_000 + RELOAD_GAP_MS + 1)).toBe(false); // 'aaa' was left behind
    expect(requestReload('bbb', 'ccc', 1_000_000 + RELOAD_GAP_MS + 1)).toBe(true);
    resetReloadMemo();
  });
});

describe('checking what the app hands in', () => {
  it('accepts well-formed tools and refuses odd ids and kinds', () => {
    expect(cleanTool({ kind: 'place', id: 'park', rot: 1 })).toEqual({ kind: 'place', id: 'park', rot: 1 });
    expect(cleanTool({ kind: 'zone', variant: 'homes' })).toEqual({ kind: 'zone', variant: 'homes' });
    expect(cleanTool({ kind: 'launch' })).toBeNull();
    expect(cleanTool({ kind: 'place', id: '<img src=x>' })).toBeNull();
    expect(cleanTool('road')).toBeNull();
  });

  it('accepts only the fourteen lenses or none, and points on the map', () => {
    expect(cleanLens('landValue')).toBe('landValue');
    expect(cleanLens('none')).toBe('none');
    expect(cleanLens('xray')).toBeNull();
    expect(cleanPoint({ x: 3, y: 63 })).toEqual({ x: 3, y: 63 });
    expect(cleanPoint({ x: 64, y: 0 })).toBeNull();
    expect(cleanPoint({ x: 1.5, y: 0 })).toBeNull();
  });

  it('accepts a well-formed ghost plan of at most 60 ops and nothing else', () => {
    const ok = [
      { op: 'road', kind: 'lane', path: [1, 1, 5, 1] },
      { op: 'zone', zone: 'homes', rect: [1, 2, 4, 1] },
      { op: 'place', id: 'well', x: 3, y: 3, rot: 0 },
      { op: 'bulldoze', rect: [0, 0, 1, 1] },
      { op: 'parcel', p: 6 },
    ];
    expect(cleanOps(ok)).toEqual(ok);
    expect(cleanOps([{ op: 'road', kind: 'lane', path: [1, 1, 5] }])).toBeNull();
    expect(cleanOps([{ op: 'place', id: 'well', x: 3, y: 3, rot: 2 }])).toBeNull();
    expect(cleanOps([{ op: 'nuke' }])).toBeNull();
    expect(cleanOps(Array(61).fill(ok[4]))).toBeNull();
    expect(cleanOps('plan')).toBeNull();
  });
});
