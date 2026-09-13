import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Every table that exists in the database but is not declared in schema.ts must
 * be named in drizzle.config.ts's tablesFilter.
 *
 * Not for tidiness. drizzle-kit pairs an undeclared table it would DROP with a
 * newly declared one it would CREATE, reads the two as a rename, and asks — which
 * needs a TTY it does not have in CI. On 2026-09-13 adding one table while
 * geo_capture_events_weight_backup_20260911 sat undeclared failed the release
 * with "Interactive prompts require a TTY terminal", and before ci-release.sh
 * learned to grep for that, the same shape exited 0 having applied nothing.
 *
 * This cannot check the live database from here, so it checks the thing that is
 * checkable: that the filter is a list with a reason against each entry, and that
 * nothing has quietly emptied it.
 */
describe('drizzle tablesFilter', () => {
  const cfg = readFileSync('drizzle.config.ts', 'utf8');

  it('names every known undeclared table', () => {
    for (const t of [
      'policy_lab_projects',
      'policy_lab_versions',
      'policy_lab_runs',
      'geo_capture_events_weight_backup_20260911',
    ]) {
      expect(cfg, `${t} must stay excluded or the next added table reads as a rename`).toContain(
        `'!${t}'`,
      );
    }
  });

  it('says why the list exists, where someone editing it will read it', () => {
    expect(cfg).toMatch(/TTY/);
    expect(cfg).toMatch(/RENAME|rename/);
  });
});
