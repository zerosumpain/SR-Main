import { describe, it, expect } from 'vitest';
import {
  WORKLOADS,
  SITE_WORKLOADS,
  HERMES_WORKLOADS,
  getWorkload,
  isWorkloadId,
  emitsImages,
} from './workloads';

describe('workload registry', () => {
  it('has unique ids and unique setting keys', () => {
    const ids = WORKLOADS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Keys only need to be unique WITHIN a scope: a site key is an app_settings
    // row and a Hermes key is a dotted config path, so a collision across the
    // two would be a coincidence, not a bug.
    for (const scope of ['site', 'hermes'] as const) {
      const keys = WORKLOADS.filter((w) => w.scope === scope).map((w) => w.key);
      expect(new Set(keys).size, `${scope} keys collide`).toBe(keys.length);
    }
  });

  it('scopes its two groups correctly', () => {
    expect(SITE_WORKLOADS.every((w) => w.scope === 'site')).toBe(true);
    expect(HERMES_WORKLOADS.every((w) => w.scope === 'hermes')).toBe(true);
    expect(WORKLOADS).toHaveLength(SITE_WORKLOADS.length + HERMES_WORKLOADS.length);
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

  it('pairs every Hermes role with a provider key', () => {
    // Writing a model without its provider leaves the engine calling the wrong
    // API — Codex reaches Hermes as `openai-codex`, not `openrouter`.
    for (const w of HERMES_WORKLOADS) {
      expect(w.providerKey, `${w.id} has no providerKey`).toBeTruthy();
    }
    // Site workloads have no provider key: provider is recovered from the id.
    expect(SITE_WORKLOADS.every((w) => !w.providerKey)).toBe(true);
  });

  it('looks roles up by id', () => {
    expect(getWorkload('extraction')?.key).toBe('jkai.intel.extract_model');
    expect(getWorkload('hermes-default')?.key).toBe('model.default');
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
