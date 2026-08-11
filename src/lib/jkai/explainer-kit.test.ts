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

  it('chart.js exposes createChart', async () => {
    const js = await read('chart.js');
    expect(js).toMatch(/createChart/);
    expect(js).toContain('http://www.w3.org/2000/svg');
  });

  it('chart.js tags series so a chart can be queried', async () => {
    const js = await read('chart.js');
    expect(js).toContain('data-series');
  });

  it('README pins the three.js version', async () => {
    const md = await read('README.md');
    expect(md).toMatch(/three@0\.\d+\.\d+/);
  });

  it('scenes.md maps every kit module to a concept shape', async () => {
    const md = await read('scenes.md');
    for (const mode of ['createScene', 'createDiagram', 'createSim', 'createChart']) {
      expect(md).toContain(mode);
    }
  });

  // The design_lint_loop guard. On 2026-08-09 a finished build died because the
  // read-only worked example the agent may not edit contained `class="grid"`,
  // which no-tailwind matches — findings stuck at 1 -> 1 -> 1 for three
  // iterations. The example must pass the rules it teaches.
  it('the worked chapter example passes the design linter it teaches', async () => {
    const { findings } = lintDesignSystem({
      'explainer/examples/chapter.html': await read('examples/chapter.html'),
    });
    expect(findings).toEqual([]);
  });

  // data-lever and data-outcome are injected into the DOM by sim.js at
  // runtime (createSim calls setAttribute for both), so they are correctly
  // absent from this file's static markup — asserting the bare strings here
  // would only prove that a sentence somewhere mentions the words, not that
  // the contract holds. The real check on their presence lives in the
  // headless-browser gate (studio-gate) built later in this plan. What is
  // statically true and load-bearing here is that the example carries
  // data-chapter and data-citation directly, and invokes the runtime that
  // produces the other two.
  it('the worked chapter example declares the contract studio-gate drives', async () => {
    const html = await read('examples/chapter.html');
    expect(html).toContain('data-chapter');
    expect(html).toContain('data-citation');
    expect(html).toMatch(/Explainer\.createSim\(/);
    // Any kit visual, not createDiagram specifically. The contract is "at
    // least one canvas or svg produced by the kit"; the example now shows a
    // composition, which createStackBar draws better than a diagram would.
    // Pinning one factory name would make every future improvement to the
    // example look like a regression.
    expect(html).toMatch(/Explainer\.create(Diagram|StackBar|Bars|Chart|Scene|Steps|Cycle|Funnel|Timeline|Tree|Matrix|Venn|IconArray|Gauge|LineBand|Comparison)\(/);
    // The chrome is mounted, not authored — the reason nav stopped 404ing.
    expect(html).toMatch(/Explainer\.mountShell\(/);
  });
});
