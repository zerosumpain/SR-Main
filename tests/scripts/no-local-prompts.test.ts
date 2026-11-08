import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

/**
 * One soul (JKai overhaul slice 9). jkai's identity lives only in
 * SR-Jkai-Core's `data/prompts/`; Main reads it from Core's identity endpoint
 * (`$lib/jkai/identity-client`). Main's copy was an orphan nothing read, and it
 * had drifted from Core's. A copy that comes back is a second soul: this fails
 * here, and SR-Infra's estate check fails on it too.
 */
describe('no local copy of the jkai prompt stack', () => {
  it('has no data/prompts directory', () => {
    expect(existsSync(join(ROOT, 'data/prompts'))).toBe(false);
  });

  it('copies none into the image or the release', () => {
    for (const file of ['Dockerfile', 'scripts/ci-release.sh']) {
      const path = join(ROOT, file);
      if (existsSync(path)) expect(readFileSync(path, 'utf8'), file).not.toMatch(/data\/prompts/);
    }
  });
});
