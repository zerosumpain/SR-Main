import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The owner lane's prose (speech, thoughts, diaries, whispers) is for the
// owner's phone only. The public landing page and the existing map route live
// in $lib/landing, so the rule "free text never reaches a visitor" stays
// structural only while nothing there can import the owner module — the
// module-boundary linter would allow it (ui may import domain), so this does not.

const ROOT = process.cwd();
const OWNER_IMPORT = /(?:\$lib\/wildmind\/owner|\.\.\/wildmind\/owner|wildmind\/owner(?:\.server)?['"])/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(ts|js|svelte)$/.test(e.name) ? [p] : [];
  });
}

describe('the Wildmind owner lane stays off the public page', () => {
  it('no $lib/landing file imports $lib/wildmind/owner', () => {
    const offenders = files(join(ROOT, 'src', 'lib', 'landing'))
      .filter((f) => OWNER_IMPORT.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('only the owner-only native routes import it', () => {
    const importers = [...files(join(ROOT, 'src', 'routes')), ...files(join(ROOT, 'src', 'lib'))]
      .filter((f) => !/\.test\.ts$/.test(f) && !f.includes(join('src', 'lib', 'wildmind')))
      .filter((f) => OWNER_IMPORT.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(importers.length).toBeGreaterThan(0);
    for (const f of importers) expect(f).toMatch(/^src\/routes\/api\/native\/wildmind\/[a-z]+\/\+server\.ts$/);
    for (const f of importers) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      // Owner-only: no member-capable wrapper anywhere, and every exported verb
      // is wrapped in withDevice (the owner gate) at its declaration.
      expect(src, f).not.toMatch(/withNativeAccess\s*\(/);
      expect(src, f).not.toMatch(/export\s*\{[^}]*\b(?:GET|POST|PUT|PATCH|DELETE|fallback)\b/);
      const verbs = [...src.matchAll(/export\s+(?:const|function|async\s+function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b[^\n]*/g)];
      expect(verbs.length, f).toBeGreaterThan(0);
      for (const [line] of verbs) expect(line, f).toMatch(/^export const (?:GET|POST|PUT|PATCH|DELETE)\b[^=]*=\s*withDevice\(/);
    }
  });
});
