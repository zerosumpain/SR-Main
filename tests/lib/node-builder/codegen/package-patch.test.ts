import { describe, it, expect } from 'vitest';
import { patchPackageJson } from '$lib/node-builder/codegen/package-patch';
import type { NodeSpec } from '$lib/node-builder/spec/types';

const baseSpec: NodeSpec = {
  type: 'apple-calendar',
  label: 'Apple Calendar',
  category: 'integrations',
  description: '',
  llmDescription: '',
  llmExamples: [],
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  configSchema: { type: 'object' },
  defaultConfig: {},
  uiSchema: { layout: 'single', sections: [] },
  executorBody: '',
  deps: [
    { name: 'tsdav', version: '^2.0.0' },
    { name: 'ical.js', version: '^2.0.0' },
  ],
  docs: '',
};

const samplePackageJson = JSON.stringify(
  {
    name: 'demo',
    version: '0.1.0',
    type: 'module',
    dependencies: {
      svelte: '^5.0.0',
    },
    devDependencies: {
      vitest: '^4.0.0',
    },
  },
  null,
  2,
) + '\n';

describe('patchPackageJson', () => {
  it('adds missing deps in alphabetical order', () => {
    const out = patchPackageJson(samplePackageJson, baseSpec);
    const parsed = JSON.parse(out);
    expect(parsed.dependencies).toEqual({
      'ical.js': '^2.0.0',
      svelte: '^5.0.0',
      tsdav: '^2.0.0',
    });
    expect(Object.keys(parsed.dependencies)).toEqual(['ical.js', 'svelte', 'tsdav']);
  });

  it('returns source unchanged when spec has no deps', () => {
    const noDeps: NodeSpec = { ...baseSpec, deps: [] };
    expect(patchPackageJson(samplePackageJson, noDeps)).toBe(samplePackageJson);
  });

  it('leaves existing pinned versions alone (no overwrite)', () => {
    const withTsdav = JSON.parse(samplePackageJson);
    withTsdav.dependencies.tsdav = '^1.5.0';
    const source = JSON.stringify(withTsdav, null, 2) + '\n';
    const out = patchPackageJson(source, baseSpec);
    const parsed = JSON.parse(out);
    expect(parsed.dependencies.tsdav).toBe('^1.5.0'); // unchanged
    expect(parsed.dependencies['ical.js']).toBe('^2.0.0'); // added
  });

  it('is idempotent — second patch makes no change', () => {
    const once = patchPackageJson(samplePackageJson, baseSpec);
    const twice = patchPackageJson(once, baseSpec);
    expect(twice).toBe(once);
  });

  it('preserves trailing newline', () => {
    const out = patchPackageJson(samplePackageJson, baseSpec);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('omits trailing newline when source has none', () => {
    const noNewline = samplePackageJson.trimEnd();
    const out = patchPackageJson(noNewline, baseSpec);
    expect(out.endsWith('\n')).toBe(false);
  });

  it('creates dependencies map when missing', () => {
    const noDeps = JSON.stringify({ name: 'x', version: '0.1.0' }, null, 2);
    const out = patchPackageJson(noDeps, baseSpec);
    const parsed = JSON.parse(out);
    expect(parsed.dependencies).toEqual({
      'ical.js': '^2.0.0',
      tsdav: '^2.0.0',
    });
  });

  it('skips entries with empty name or version', () => {
    const bad: NodeSpec = {
      ...baseSpec,
      deps: [
        { name: '', version: '^1.0.0' },
        { name: 'good', version: '' },
        { name: 'real', version: '^3.0.0' },
      ],
    };
    const out = patchPackageJson(samplePackageJson, bad);
    const parsed = JSON.parse(out);
    expect(parsed.dependencies).toEqual({
      real: '^3.0.0',
      svelte: '^5.0.0',
    });
  });
});
