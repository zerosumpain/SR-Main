import { describe, it, expect } from 'vitest';
import { CHAPTER_FORMS, CONTROL_KINDS, STUDY_TEMPLATES } from './planner';
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

  it('carries the SITE palette, not a register of its own', async () => {
    // A studio build is a field study, and the Field Study System extends the
    // site's language with the SAME palette. The kit used to make petrol the
    // accent on a lighter cream, so a studio build came out petrol-on-#f2ead9
    // while every hand-built study is orange-on-#ede4d4 — which is what "the
    // layout is applied but not the palette" looked like on the page.
    const css = await read('tokens.css');
    expect(css).toMatch(/--ex-bg:\s*#ede4d4/);
    expect(css).toMatch(/--ex-accent:\s*#c4570a/);
    expect(css).toMatch(/--ex-accent-ink:\s*#0e5b66/);
  });

  it('keeps the accent relationship the same in both themes', async () => {
    // Burnt orange is primary and petrol is the counter-accent. The dark block
    // had them the other way round, so a study changed its mind about which
    // colour meant "primary" depending on the reader's OS setting.
    const css = await read('tokens.css');
    const dark = css.slice(css.indexOf('prefers-color-scheme'));
    expect(dark).toMatch(/--ex-accent:\s*#e8834a/);
    expect(dark).toMatch(/--ex-accent-ink:\s*#4ea3b0/);
  });

  it('binds the confidence colours to the two accents by name', async () => {
    // Not `var(--ex-accent)` for fact: the whole point is that fact is the
    // SETTLED colour (petrol) and hypothesis is the one still being argued
    // (orange). Inheriting whichever token is currently "the accent" is how
    // they silently swapped.
    const css = await read('field-study/field-study.css');
    expect(css).toMatch(/--fs-fact:\s*var\(--ex-accent-ink/);
    expect(css).toMatch(/--fs-hypothesis:\s*var\(--ex-accent[,)]/);
    expect(css).toMatch(/--fs-contested:\s*#8a2d3a/);
  });

  it('tokens.css passes the design linter', async () => {
    const { findings } = lintDesignSystem({ 'explainer/tokens.css': await read('tokens.css') });
    expect(findings).toEqual([]);
  });

  it('mounts the Field Study System beside the kit', async () => {
    // A studio build is an information project and this is the system it is
    // built against. The prompt tells the agent to read TEMPLATES.md and to
    // link field-study.css; both have to actually arrive in the workspace.
    for (const rel of [
      'field-study/README.md',
      'field-study/TEMPLATES.md',
      'field-study/templates.json',
      'field-study/field-study.css',
      'field-study/CHECKLIST.md',
    ]) {
      await expect(read(rel)).resolves.toBeTruthy();
    }
  });

  it('carries every template the planner can emit', async () => {
    // The plan's Template cell is parsed against STUDY_TEMPLATES; a template
    // the spine names and the registry does not describe is a chapter the
    // agent has no instructions for.
    const registry = JSON.parse(await read('field-study/templates.json'));
    const ids = JSON.stringify(registry).toLowerCase();
    for (const t of STUDY_TEMPLATES) expect(ids).toContain(t);
  });

  it("field-study.css is written against the kit's tokens, not the site's", async () => {
    // A studio build loads tokens.css and never loads app.css. A straight copy
    // of the site layer would reference --accent / --bg / --text-primary, find
    // nothing, and fall back to initial values — black on transparent.
    const css = await read('field-study/field-study.css');
    expect(css).toMatch(/--ex-ink/);
    expect(css).toMatch(/--ex-accent/);
    expect(css).not.toMatch(/var\(--text-primary\)/);
    expect(css).not.toMatch(/var\(--accent-tint-08\)/);
    // The three confidence levels are the whole scale, and the chip classes
    // are what the studio gate asserts on.
    for (const level of ['fs-chip--fact', 'fs-chip--hypothesis', 'fs-chip--contested']) {
      expect(css).toContain(level);
    }
  });

  it('does not import a second copy of the fonts tokens.css already loads', async () => {
    // Two @imports of Fraunces is a second network round trip for a face the
    // page already has. Matched as an at-rule at the start of a line, not as
    // the word anywhere — the file's own comment tells the reader not to add
    // one, and a blunter regex fails on that sentence.
    const css = await read('field-study/field-study.css');
    expect(css).not.toMatch(/^\s*@import/m);
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

// The form vocabulary exists twice by necessity: planner.ts produces it and
// shell.js renders it, and a browser script cannot import TypeScript. This
// repo already has one detector living in three drifting copies; two copies
// are the minimum here, so pin them together.
describe('the chapter-form vocabulary does not drift', () => {
  it('shell.js implements exactly the forms the planner can emit', async () => {
    const js = await read('shell.js');
    const declared = /ns\.CHAPTER_FORMS\s*=\s*Object\.keys\(FORMS\)/.test(js);
    expect(declared).toBe(true);
    for (const form of CHAPTER_FORMS) {
      // Each form must be a real key in shell.js's FORMS table, not just a
      // name in a comment — a form the planner can pick and the shell cannot
      // render silently falls back to the identical layout this replaced.
      expect(js).toMatch(new RegExp(`^\\s{4}${form}:\\s*\\{`, 'm'));
    }
  });

  it('every form has a stylesheet rule, or it is a layout in name only', async () => {
    const css = await read('shell.css');
    for (const form of CHAPTER_FORMS) {
      expect(css).toContain(`.ex-form-${form}`);
    }
  });

  it('sim.js builds every control kind the planner can emit', async () => {
    const js = await read('sim.js');
    for (const kind of CONTROL_KINDS) {
      expect(js).toContain(`'${kind}'`);
    }
    // The regression that made this necessary: one hardcoded control type.
    expect(js).toMatch(/kind === 'slider'/);
  });
});
