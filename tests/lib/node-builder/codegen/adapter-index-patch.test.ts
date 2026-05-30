import { describe, it, expect } from 'vitest';
import { patchAdapterIndex } from '$lib/node-builder/codegen/adapter-index-patch';
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
  deps: [],
  docs: '',
  integrationType: 'apple-calendar',
};

describe('patchAdapterIndex', () => {
  it('creates the barrel with a header + import when source is empty', () => {
    const out = patchAdapterIndex('', baseSpec);
    expect(out).toContain("import './apple-calendar';");
    expect(out).toContain('Side-effect imports');
  });

  it('appends a new import to an existing barrel', () => {
    const existing =
      `// Side-effect imports for integration adapters.\n` +
      `\n` +
      `import './slack';\n`;
    const out = patchAdapterIndex(existing, baseSpec);
    expect(out).toContain("import './slack';");
    expect(out).toContain("import './apple-calendar';");
  });

  it('is idempotent — patching twice produces the same output', () => {
    const once = patchAdapterIndex('', baseSpec);
    const twice = patchAdapterIndex(once, baseSpec);
    expect(twice).toBe(once);
  });

  it('returns the source unchanged when spec has no integrationType', () => {
    const noIntegration: NodeSpec = { ...baseSpec, integrationType: undefined };
    const existing = `import './slack';\n`;
    expect(patchAdapterIndex(existing, noIntegration)).toBe(existing);
  });
});
