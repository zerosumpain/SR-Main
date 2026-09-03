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

  it('gives the four formerly per-call reasons a key of their own', () => {
    // The whole point of the 2026-09-03 change: every reason on
    // /admin/ops/costs names a model you can set. A missing key here puts the
    // row back to "per-call", which is how it read for months.
    for (const id of ['chat', 'workflow-node', 'daydream-review', 'notebook-review']) {
      const w = getWorkload(id);
      expect(w, `${id} is not registered`).toBeTruthy();
      expect(w!.key, `${id} has no settings key`).toMatch(/^jkai\./);
    }
  });

  it('does not let the chat role collide with the site default key', () => {
    // `jkai.chat.default_model` IS the site default. A workload reading it
    // would make "move chat" and "move everything" the same switch again.
    expect(getWorkload('chat')!.key).not.toBe('jkai.chat.default_model');
    expect(WORKLOADS.some((w) => w.key === 'jkai.chat.default_model')).toBe(false);
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

/**
 * The tag and the registry must agree.
 *
 * `withActivity('<id>')` writes a bare string into the ledger, and
 * `activityKey()` returns it verbatim. A typo therefore does not throw and does
 * not show up as an error — it opens a NEW activity key that no row on
 * /admin/ops/costs knows how to name or switch, and the spend quietly
 * disappears into it. That is the same shape as the tools that shipped and were
 * never called: working code, no signal.
 *
 * So this walks the source for every literal tag and checks it against the
 * registry. `research-fast` / `research-deep` are also reached through
 * `DepthPreset.modelRole`, which is why they must be ids and not free strings.
 */
describe('activity tags match the registry', () => {
  it('every withActivity() id in the source is a registered workload', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|svelte)$/.test(full) && !full.endsWith('.test.ts')) out.push(full);
      }
      return out;
    };

    const ids = new Set(WORKLOADS.map((w) => w.id));
    const bad: string[] = [];
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/withActivity\(\s*'([^']+)'/g)) {
        if (!ids.has(m[1])) bad.push(`${file}: '${m[1]}'`);
      }
    }
    expect(bad, `unregistered activity tags:\n${bad.join('\n')}`).toEqual([]);
  });

  /**
   * The hole the literal scan above cannot see.
   *
   * `heartbeat/engine.ts` tags each system-scan with `withActivity(row.name)` —
   * a VARIABLE, so the regex above never looked at it, and `row.name` is a
   * heartbeat action name rather than a workload id. The result was six keys in
   * the production ledger (`daydream-ponder`, `workflow-review`, …) that no row
   * on /admin/ops/costs could name, switch, or even display: the page's loop
   * skipped every non-`source:` key it did not recognise, so the spend was
   * invisible AND counted as attributed.
   *
   * The page now renders them, badged `unregistered`. This test holds the other
   * half: a dynamic tag must be a deliberate, documented exception, so if a
   * second one appears someone has to come here and say why.
   */
  it('keeps dynamic activity tags to the one documented case', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|svelte)$/.test(full) && !full.endsWith('.test.ts')) out.push(full);
      }
      return out;
    };
    const allowed = new Set(['src/lib/heartbeat/engine.ts', 'src/lib/deepdive/worker.ts']);
    const dynamic: string[] = [];
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/withActivity\(\s*([^'\s)][^,)]*)/g)) {
        if (!allowed.has(file.replace(/\\/g, '/'))) dynamic.push(`${file}: ${m[1].trim()}`);
      }
    }
    expect(dynamic, `undocumented dynamic activity tags:\n${dynamic.join('\n')}`).toEqual([]);
  });

  it('registers both research tiers, which DepthPreset.modelRole names', () => {
    expect(ids()).toContain('research-fast');
    expect(ids()).toContain('research-deep');
  });
});

function ids(): string[] {
  return WORKLOADS.map((w) => w.id);
}
