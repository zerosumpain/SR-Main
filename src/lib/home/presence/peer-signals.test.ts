import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: { execute: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

const { isFromPeer, signalPayload, TRAIL_CHANNEL } = await import('./peer-signals.server');
const { trailChanged, trailChangedElsewhere, trailGeneration, onTrailChanged } = await import('./trail-generation');

describe('peer signals', () => {
  it('acts only on the trail channel, from another process', () => {
    expect(isFromPeer(TRAIL_CHANNEL, 'another-instance')).toBe(true);
    expect(isFromPeer(TRAIL_CHANNEL, signalPayload())).toBe(false);
    expect(isFromPeer(TRAIL_CHANNEL, undefined)).toBe(false);
    expect(isFromPeer('something_else', 'another-instance')).toBe(false);
  });
});

describe('trail generation', () => {
  it('announces this process’s own writes, and only those', () => {
    const announce = vi.fn();
    onTrailChanged(announce);
    const before = trailGeneration();
    trailChanged();
    trailChangedElsewhere();
    expect(trailGeneration()).toBe(before + 2);
    expect(announce).toHaveBeenCalledTimes(1);
    onTrailChanged(null);
  });
});
