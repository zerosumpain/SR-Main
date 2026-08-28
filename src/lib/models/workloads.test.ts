import { describe, it, expect } from 'vitest';
import {
  WORKLOADS,
  SITE_WORKLOADS,
  getWorkload,
  isWorkloadId,
  emitsImages,
} from './workloads';

describe('workload registry', () => {
  it('has unique ids and unique setting keys', () => {
    const ids = WORKLOADS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = WORKLOADS.map((w) => w.key);
    expect(new Set(keys).size, 'setting keys collide').toBe(keys.length);
  });

  it('scopes every role to the site', () => {
    expect(SITE_WORKLOADS.every((w) => w.scope === 'site')).toBe(true);
    expect(WORKLOADS).toHaveLength(SITE_WORKLOADS.length);
  });

  it('gives every code-pinned role a stated reason', () => {
    // This is the invariant the whole feature exists to hold: a role may differ
    // from the site default, but never silently. If you add a fallback, say why.
    for (const w of WORKLOADS) {
      if (w.fallbackModelId) {
        expect(w.reason, `${w.id} pins ${w.fallbackModelId} with no reason`).toBeTruthy();
      }
    }
  });

  it('looks roles up by id', () => {
    expect(getWorkload('extraction')?.key).toBe('jkai.intel.extract_model');
    expect(getWorkload('nope')).toBeNull();
    expect(isWorkloadId('doctor')).toBe(true);
    expect(isWorkloadId('doctor-who')).toBe(false);
  });
});

describe('emitsImages', () => {
  it('reads the OUTPUT side of the modality only', () => {
    // The distinction that matters: a vision model reads images and writes text.
    // Treating it as a generator is how you get prose where a picture should be.
    expect(emitsImages('text+image->text')).toBe(false);
    expect(emitsImages('text+image+file->text')).toBe(false);
    expect(emitsImages('text+image->text+image')).toBe(true);
    expect(emitsImages('text+image+file->text+image')).toBe(true);
  });

  it('treats missing or malformed modality as "no"', () => {
    expect(emitsImages(null)).toBe(false);
    expect(emitsImages(undefined)).toBe(false);
    expect(emitsImages('')).toBe(false);
    expect(emitsImages('image')).toBe(false);
  });
});
