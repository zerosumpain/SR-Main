// PAGE_HASH (spec §10.10): the map page's version, ENGINE_HASH plus every page
// build input. It must be current, and the wire must name its folder.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computePageHash, pageFiles } from '../../../../scripts/hometowns/page-hash.mjs';
import { ENGINE_HASH } from './engine/index';
import { PAGE_HASH } from './page-hash.generated';
import { createRoom } from './hometowns';
import { PAGE_PATH, toWire } from './wire';

describe('PAGE_HASH', () => {
  it('is current (rerun node scripts/hometowns/page-hash.mjs after any engine or page change)', () => {
    expect(PAGE_HASH).toBe(computePageHash());
  });

  it('covers the Lab bots the harness bundles, which ENGINE_HASH leaves out (a bot change is a page change)', () => {
    const files = pageFiles();
    expect(files).toContain('src/lib/games/hometowns/engine/bots/index.ts');
    expect(files).toContain('src/lib/games/hometowns/engine/bots/mayors.ts');
    expect(files.some((f) => f.endsWith('.test.ts'))).toBe(false);
  });

  it('names a page folder of its own: never the engine hash, so a page-only change cannot collide', () => {
    expect(PAGE_HASH).toMatch(/^[0-9a-f]{16}$/);
    expect(PAGE_HASH).not.toBe(ENGINE_HASH);
  });

  it('is the page the wire names, beside the engine hash the canary compares', () => {
    const host = { id: 'p_host', name: 'Mayor' };
    const room = createRoom({ id: 'g_pagehash', host, invite: [], difficulty: 'easy', options: {}, now: 1_792_497_600_000 });
    const w = toWire(room, host.id, 1_792_497_600_000);
    expect(PAGE_PATH).toBe(`/projects/hometowns/${PAGE_HASH}/mobile.html`);
    expect(w.client).toEqual({ engineHash: ENGINE_HASH, page: PAGE_PATH, bridge: 1 });
  });

  it('is the page every wire fixture names (else rerun npx tsx scripts/hometowns/wire-fixtures.ts and copy fixtures/hometowns/*.json to the app tests)', () => {
    const dir = new URL('../../../../fixtures/hometowns/', import.meta.url);
    const frames = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'copy-hash.json');
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      const { client } = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as { client: unknown };
      expect({ fixture: f, client }).toEqual({ fixture: f, client: { engineHash: ENGINE_HASH, page: PAGE_PATH, bridge: 1 } });
    }
  });
});
