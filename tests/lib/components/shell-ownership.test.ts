import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

/**
 * The health domain is due to leave SR-Main with its own directory. Anything
 * outside it that imports `$lib/components/health/` is a file that would be left
 * importing a deleted path on the day it goes.
 *
 * That was nearly the whole site: HealthShell is the page chrome for /blog,
 * /decks, /news, /projects and /research, and it lived under a health path by
 * accident of history. It is in $lib/components/shell/ now, and this is what
 * stops it drifting back.
 */
describe('health component ownership', () => {
  it('is imported by nothing outside the health domain', () => {
    // grep -a: several source files in this repo contain NUL bytes, and plain
    // grep reports those as binary and finds nothing in them.
    const hits = execFileSync(
      'bash',
      [
        '-c',
        `grep -ran --include='*.svelte' --include='*.ts' '\\$lib/components/health/' src \
          | grep -v '^src/lib/components/health/' \
          | grep -v '^src/lib/components/trails/' \
          | grep -v '^src/lib/health/' \
          | grep -v '^src/lib/trails/' \
          | grep -v '^src/routes/health/' \
          | grep -v '^src/lib/components/shell/format.ts' || true`,
      ],
      { encoding: 'utf8' },
    ).trim();

    expect(hits, `these import the health component tree from outside it:\n${hits}`).toBe('');
  });

  it('keeps the shared shell free of domain imports', () => {
    const shell = execFileSync(
      'bash',
      ['-c', `grep -ahn "^\\s*import" src/lib/components/shell/*.svelte src/lib/components/shell/*.ts || true`],
      { encoding: 'utf8' },
    );
    // A shell that imports a domain is not a shell.
    expect(shell).not.toMatch(/\$lib\/(health|trails|drive|jkai|deepdive|daydream)\b/);
  });
});
