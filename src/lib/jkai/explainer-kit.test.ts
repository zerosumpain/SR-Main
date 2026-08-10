import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { lintDesignSystem } from './design-lint';

const KIT = 'static/explainer-kit';

async function read(rel: string): Promise<string> {
  return readFile(`${KIT}/${rel}`, 'utf-8');
}

describe('explainer kit', () => {
  it('ships a tokens file that defines the fonts the linter demands', async () => {
    const css = await read('tokens.css');
    expect(css).toMatch(/--font-display\s*:/);
    expect(css).toMatch(/--font-body\s*:/);
    expect(css).toMatch(/--font-mono\s*:/);
  });

  it('tokens.css passes the design linter', async () => {
    const { findings } = lintDesignSystem({ 'explainer/tokens.css': await read('tokens.css') });
    expect(findings).toEqual([]);
  });

  it('sim.js exposes createSim on window.Explainer', async () => {
    const js = await read('sim.js');
    expect(js).toMatch(/window\.Explainer/);
    expect(js).toMatch(/createSim/);
  });

  it('sim.js tags controls and outcomes so the gate can drive them', async () => {
    const js = await read('sim.js');
    expect(js).toContain('data-lever');
    expect(js).toContain('data-outcome');
  });

  it('diagram.js exposes createDiagram and emits svg', async () => {
    const js = await read('diagram.js');
    expect(js).toMatch(/createDiagram/);
    expect(js).toContain('createElementNS');
    expect(js).toContain('http://www.w3.org/2000/svg');
  });

  it('diagram.js tags nodes so a chapter can link a lever to a mechanism', async () => {
    const js = await read('diagram.js');
    expect(js).toContain('data-node');
  });

  it('ships a pinned three.js build', async () => {
    const js = await read('three.min.js');
    expect(js.length).toBeGreaterThan(100_000);
    expect(js).toMatch(/REVISION/);
  });

  it('lowpoly.js exposes createScene and renders to a canvas', async () => {
    const js = await read('lowpoly.js');
    expect(js).toMatch(/createScene/);
    expect(js).toMatch(/WebGLRenderer/);
    expect(js).toContain('data-scene');
  });
});
