import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDeployVersion } from './deploy-version';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('deployment version', () => {
  it('reads the identity of the selected build', () => {
    const root = mkdtempSync(join(tmpdir(), 'deploy-version-'));
    roots.push(root);
    mkdirSync(join(root, 'build'));
    writeFileSync(
      join(root, 'build', '.deploy-sha'),
      [
        'sha=1234567890abcdef',
        'short=12345678',
        'tree=abcdef1234567890',
        'built_at=2026-09-01T20:00:00Z',
        'promoted_at=2026-09-01T20:04:00Z',
        'via=github-actions-promoted',
      ].join('\n'),
    );

    expect(getDeployVersion(root)).toEqual({
      sha: '1234567890abcdef',
      short: '12345678',
      tree: 'abcdef1234567890',
      builtAt: '2026-09-01T20:00:00Z',
      promotedAt: '2026-09-01T20:04:00Z',
      via: 'github-actions-promoted',
    });
  });

  it('has an explicit development fallback when no stamp exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'deploy-version-'));
    roots.push(root);
    expect(getDeployVersion(root)).toMatchObject({ sha: null, short: 'development', via: 'local' });
  });
});
