import { afterEach, describe, expect, it, vi } from 'vitest';
import { appUpdate, applyAppUpdate, offerAppUpdate } from './update-state.svelte';

afterEach(() => {
  appUpdate.available = false;
  appUpdate.installing = false;
  appUpdate.nextVersion = null;
  appUpdate.apply = null;
  appUpdate.error = null;
});

describe('PWA update state', () => {
  it('holds the update until the user applies it', async () => {
    const apply = vi.fn(async () => {});
    offerAppUpdate(apply, 'deadbeef');

    expect(appUpdate).toMatchObject({ available: true, nextVersion: 'deadbeef' });
    expect(apply).not.toHaveBeenCalled();

    await applyAppUpdate();
    expect(apply).toHaveBeenCalledOnce();
    expect(appUpdate.available).toBe(false);
  });

  it('keeps the update available and reports an apply failure', async () => {
    offerAppUpdate(async () => {
      throw new Error('worker activation timed out');
    }, 'deadbeef');

    await applyAppUpdate();

    expect(appUpdate.available).toBe(true);
    expect(appUpdate.installing).toBe(false);
    expect(appUpdate.error).toBe('worker activation timed out');
  });
});
