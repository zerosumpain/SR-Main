// The engine's purity rules, enforced by reading its source (spec §10.4,
// §12.1 item 6, §17): no hidden inputs, no platform-dependent maths or
// formatting, no imports from outside the engine, and none of the banned
// product names anywhere in the engine, the scripts or the page.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeEngineHash } from '../../../../../scripts/hometowns/engine-hash.mjs';
import { ENGINE_HASH } from './engine-hash.generated';

const ENGINE = new URL('.', import.meta.url).pathname;
const REPO = join(ENGINE, '../../../../..');

function walk(dir: string, keep: (p: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'dist') continue;
    if (statSync(p).isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out.sort();
}

/** Source with comments removed, so a comment may explain a rule without tripping it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const engineSources = walk(ENGINE, (p) => p.endsWith('.ts') && !p.endsWith('.test.ts'));

describe('engine purity (banned APIs)', () => {
  const rules: [RegExp, string][] = [
    [/Math\.random/, 'Math.random'],
    [/\bDate\b/, 'Date'],
    [/performance\.now/, 'performance.now'],
    [/\bIntl\b/, 'Intl'],
    [/toLocale(String|DateString|TimeString)/, 'toLocaleString'],
    [/\.toFixed\(|\.toPrecision\(/, 'toFixed/toPrecision'],
    [/Math\.(exp|expm1|log|log1p|log2|log10|pow|tanh|sinh|cosh|asinh|acosh|atanh|sin|cos|tan|asin|acos|atan|atan2|cbrt|hypot)\b/, 'transcendental Math.*'],
    [/\*\*/, 'the ** operator (Math.pow in disguise)'],
    [/\bprocess\.|\bwindow\.|\bdocument\.|\blocalStorage\b|\bcrypto\./, 'a platform global'],
  ];

  it('finds the engine sources', () => {
    expect(engineSources.length).toBeGreaterThan(20);
  });

  for (const file of engineSources) {
    it(`${relative(ENGINE, file)} uses only deterministic APIs`, () => {
      const src = code(readFileSync(file, 'utf8'));
      const hits = rules.filter(([re]) => re.test(src)).map(([, name]) => name);
      expect(hits).toEqual([]);
    });
  }

  it('imports only sibling engine files', () => {
    const bad: string[] = [];
    for (const file of engineSources) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm)) {
        const spec = m[1];
        if (!spec.startsWith('./') && !spec.startsWith('../')) bad.push(`${relative(ENGINE, file)} → ${spec}`);
        else {
          const target = join(file, '..', spec);
          if (!target.startsWith(ENGINE.replace(/\/$/, ''))) bad.push(`${relative(ENGINE, file)} → ${spec}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps no Map or Set in stored state (types.ts declares none)', () => {
    const types = code(readFileSync(join(ENGINE, 'types.ts'), 'utf8'));
    // Typed arrays appear only in DerivedCache slots (never stored); state interfaces use number[].
    expect(types).not.toMatch(/\bMap<|\bSet</);
  });
});

describe('clean-room provenance (§17)', () => {
  it('has PROVENANCE.md with the clean-room statement', () => {
    const text = readFileSync(join(ENGINE, 'PROVENANCE.md'), 'utf8');
    expect(text).toContain('no GPL code, art or text was used');
  });

  it('never names the classic games in the engine, the scripts or the page', () => {
    const files = [
      ...walk(join(ENGINE, '..'), (p) => /\.(ts|js|mjs|json|md|svelte|html|css)$/.test(p)),
      ...walk(join(REPO, 'scripts/hometowns'), (p) => /\.(ts|js|mjs|json|md|sh|html)$/.test(p)),
      ...walk(join(REPO, 'games/hometowns-view'), (p) => /\.(ts|js|mjs|json|md|svelte|html|css)$/.test(p)),
    ];
    const banned = new RegExp(['sim' + 'city', 'micro' + 'polis'].join('|'), 'i');
    const hits = files.filter((f) => banned.test(readFileSync(f, 'utf8'))).map((f) => relative(REPO, f));
    expect(hits).toEqual([]);
  });
});

describe('ENGINE_HASH', () => {
  it('is current (rerun node scripts/hometowns/engine-hash.mjs after any engine change)', () => {
    expect(ENGINE_HASH).toBe(computeEngineHash());
  });
});
