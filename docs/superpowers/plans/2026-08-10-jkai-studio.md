# jkai Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give jkai a `studio` build mode that turns a challenge statement into a published, multi-chapter, visually driven, interactive learning project at `/projects/<slug>/`, without a human in the loop.

**Architecture:** A third prompt mode alongside `app` and `repo`, mirroring the Forge's shape — a preconfigured build creator (`studio.ts` ≈ `forge.ts`), its own system prompt, its own read-only workspace mount, and its own post-iteration gate. Everything else reuses the existing builder pipeline: orchestrator, executor, pi-runner, budget, publish.

**Tech Stack:** TypeScript, SvelteKit, Drizzle/Postgres, vitest, Playwright (headless Chromium, already on the host), vendored three.js.

**Spec:** `docs/superpowers/specs/2026-08-10-jkai-studio-explainer-builds-design.md`

## Global Constraints

- **Test command is `npx vitest run <path>`.** Never `npm test` (that runs the full gate).
- **The explainer kit lives in `static/explainer-kit/`.** Not `packages/` — `ci-deploy.sh` never syncs `packages/`. `static/` is copied into `build/client/` by the adapter and `build/` is rsynced wholesale, so no allow-list change is needed. This mirrors `syncJkaiExtension`, which already reads `static/jkai-extensions/jkai-tools.js` with a `build/client/...` fallback.
- **`scripts/studio-gate.mjs` DOES need its own line in `ci-deploy.sh`.** The script rsyncs an explicit allow-list; `scripts/smoke-static-app.mjs` has its own line at line 61. A missing line means the gate fails soft in production and silently reports nothing. This is Task 12, Step 6 — do not skip it.
- **A gate that cannot run reports `ran: false`, never `passed: false`.** Copied verbatim from `static-smoke.ts`'s contract. A broken harness reporting a failing app blocks good work and teaches the model to route around the tool.
- **Every gate finding names a file and a remedy.** On 2026-08-09 a build whose app was complete and serving 200 at iteration 1 died at iteration 3 on `design_lint_loop`, because the read-only mount the agent was forbidden to edit contained `<div class="grid">`, which `no-tailwind` matches. Findings stuck at 1 → 1 → 1.
- **Design-lint forbidden tokens in any file the linter sees:** raw `#rrggbb` outside a `--custom-prop:` declaration or a `tokens.css`; `class="…"` containing `bg-`, `text-`, `p-<digit>`, `m-<digit>`, `w-<digit>`, `h-<digit>`, `flex`, or `grid` as a whole word (note: **`chapter-grid` matches** — `-` is a word boundary); `font-family:` not starting with `var(`, `inherit`, `initial`, `unset` or `revert`. Also avoid `href="#abc"`-style anchors whose fragment is 3–8 hex characters — `HEX_RE` matches those.
- **Studio builds set `origin: 'studio'`, `planStatus: 'approved'`, `enforceDesignSystem: true`.** Design enforcement stays ON; only the mounted worked example changes.
- **Do not touch repo mode or Forge.** `REPO_SYSTEM_PROMPT`, `forge.ts` and the git-target branches in `orchestrator.ts` are out of scope.

---

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `static/explainer-kit/tokens.css` | Explainer palette, derived from site tokens |
| `static/explainer-kit/sim.js` | Lever runtime — parameters + step function → controls + live outcome |
| `static/explainer-kit/diagram.js` | Causal/system diagrams, ported from `CausalFlow.svelte` |
| `static/explainer-kit/lowpoly.js` | Isometric low-poly scene over three.js |
| `static/explainer-kit/chart.js` | Small-multiples, line and bar primitives |
| `static/explainer-kit/three.min.js` | Vendored, pinned three.js |
| `static/explainer-kit/README.md` | How to use the kit |
| `static/explainer-kit/scenes.md` | Scene grammar: which mode for which concept |
| `static/explainer-kit/examples/chapter.html` | Canonical chapter — scene + levers + citations |
| `src/lib/jkai/studio.ts` | `createStudioBuild`, studio budget const |
| `src/lib/jkai/studio.test.ts` | Budget shape, insert shape |
| `src/lib/jkai/research-brief.ts` | Deep-dive session → FACTS/GAPS brief |
| `src/lib/jkai/research-brief.test.ts` | Brief parsing, gap-dominance refusal |
| `src/lib/jkai/studio-gate.ts` | Chapter inventory / interactivity / visual / sourcing checks |
| `src/lib/jkai/studio-gate.test.ts` | Output parsing, finding fixability |
| `scripts/studio-gate.mjs` | Playwright runner driving a served multi-chapter app |
| `src/routes/api/jkai/studio/+server.ts` | Owner-gated create endpoint |
| `src/lib/workflows/site-tools/tools/studio.ts` | `studio_build` tool for chat |

**Modify**

| File | Change |
|---|---|
| `src/lib/jkai/prompt.ts` | `STUDIO_SYSTEM_PROMPT`; `BuildPromptMode` gains `'studio'` |
| `src/lib/jkai/design-assets.ts` | `buildExplainerAssets()` alongside `buildDesignAssets()` |
| `src/lib/jkai/design-lint.ts` | `DESIGN_MOUNT_RE` covers `explainer-kit/` |
| `src/lib/jkai/sandbox.ts` | `syncExplainerKit(buildId)` |
| `src/lib/jkai/executor.ts` | Select studio mode; mount the kit |
| `src/lib/jkai/planner.ts` | Brief injection; chapter template; PEDAGOGY + SOURCING |
| `src/lib/jkai/orchestrator.ts` | Run studio-gate after `manageServeConfig` |
| `src/lib/db/schema.ts` | `researchBrief`, `chapterPlan` jsonb; `origin` enum + `'studio'` |
| `src/routes/jkai/builds/new/+page.svelte` | Studio option |
| `scripts/ci-deploy.sh` | rsync line for `scripts/studio-gate.mjs` |

---

## Task 1: Explainer kit — tokens and the lever runtime

The lever runtime is the load-bearing piece: "explain → manipulate → consequence" is the whole definition of a learning artefact here, and `sim.js` is what makes it cheap for the agent to build one. Generalised from `src/routes/projects/policy-engine/lib/engine.ts` and `lib/levers.ts`.

**Files:**
- Create: `static/explainer-kit/tokens.css`
- Create: `static/explainer-kit/sim.js`
- Test: `src/lib/jkai/explainer-kit.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: global `window.Explainer.createSim(spec)` where
  `spec = { mount: HTMLElement, levers: Array<{ id: string, label: string, min: number, max: number, step: number, value: number, unit?: string }>, outcomes: Array<{ id: string, label: string, unit?: string, format?: (n:number)=>string }>, step: (values: Record<string,number>) => Record<string,number> }`
  returns `{ values, set(id, v), recompute(), destroy() }`. Renders controls into `mount`, and an outcome readout whose values carry `data-outcome="<id>"`. Controls carry `data-lever="<id>"`.

- [ ] **Step 1: Write the failing test**

`src/lib/jkai/explainer-kit.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/jkai/explainer-kit.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open 'static/explainer-kit/tokens.css'`

- [ ] **Step 3: Write `static/explainer-kit/tokens.css`**

Raw hex is legal here — `design-lint.ts` exempts any file matching `/tokens\.css$/i` from `no-raw-hex`. It is not exempt from the other two rules, so no `font-family:` and no Tailwind-shaped class attributes in this file.

```css
/* Explainer kit tokens — derived from the Strange Ramblings palette.
   Raw hex is legal in this file and nowhere else. */
:root {
  --ex-bg: #faf8f4;
  --ex-surface: #ffffff;
  --ex-ink: #17150f;
  --ex-ink-soft: #565043;
  --ex-rule: #d9d3c6;
  --ex-accent: #c2410c;
  --ex-accent-soft: #fde3d3;

  /* Sequential ramp for scene tiles and choropleths — perceptually ordered. */
  --ex-ramp-0: #f4ede2;
  --ex-ramp-1: #e8cfae;
  --ex-ramp-2: #d9a86e;
  --ex-ramp-3: #c2410c;
  --ex-ramp-4: #7c2408;

  /* Categorical series — max six, distinguishable in greyscale. */
  --ex-cat-1: #1d4e63;
  --ex-cat-2: #c2410c;
  --ex-cat-3: #6b7f3a;
  --ex-cat-4: #8a5a9c;
  --ex-cat-5: #b08900;
  --ex-cat-6: #4a4a4a;

  --ex-good: #2f6b3f;
  --ex-warn: #b08900;
  --ex-bad: #a32b1c;

  --font-display: 'Archivo Black', system-ui, sans-serif;
  --font-body: 'DM Sans', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  --ex-radius: 2px;
  --ex-gap: 1rem;
}

@media (prefers-color-scheme: dark) {
  :root {
    --ex-bg: #14120e;
    --ex-surface: #1d1a15;
    --ex-ink: #f3efe7;
    --ex-ink-soft: #a49c8c;
    --ex-rule: #38332a;
    --ex-accent: #f97316;
    --ex-accent-soft: #3a2214;
  }
}
```

- [ ] **Step 4: Write `static/explainer-kit/sim.js`**

```js
/* Explainer kit — lever runtime.
 *
 * Generalised from src/routes/projects/policy-engine/lib/engine.ts + levers.ts.
 * You declare parameters and a pure step function; this renders the controls,
 * runs the model on every change, and paints the outcomes.
 *
 * Controls carry data-lever="<id>" and outcome values carry
 * data-outcome="<id>". studio-gate drives those attributes — if you hand-roll
 * controls instead of using this, tag them the same way or the interactivity
 * check has nothing to click.
 */
(function () {
  const ns = (window.Explainer = window.Explainer || {});

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function defaultFormat(n) {
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  ns.createSim = function createSim(spec) {
    const mount = spec.mount;
    if (!mount) throw new Error('createSim: spec.mount is required');
    const levers = spec.levers || [];
    const outcomes = spec.outcomes || [];
    const step = spec.step;
    if (typeof step !== 'function') throw new Error('createSim: spec.step must be a function');

    const values = {};
    for (const l of levers) values[l.id] = l.value;

    const root = el('div', 'ex-sim');
    const controls = el('div', 'ex-sim-controls');
    const readout = el('div', 'ex-sim-readout');
    root.appendChild(controls);
    root.appendChild(readout);
    mount.appendChild(root);

    const outEls = {};
    for (const o of outcomes) {
      const row = el('div', 'ex-outcome');
      row.appendChild(el('span', 'ex-outcome-label', o.label));
      const v = el('strong', 'ex-outcome-value', '—');
      v.setAttribute('data-outcome', o.id);
      row.appendChild(v);
      if (o.unit) row.appendChild(el('span', 'ex-outcome-unit', o.unit));
      readout.appendChild(row);
      outEls[o.id] = v;
    }

    function recompute() {
      let result;
      try {
        result = step({ ...values }) || {};
      } catch (err) {
        for (const o of outcomes) outEls[o.id].textContent = 'error';
        console.error('[explainer] step() threw', err);
        return;
      }
      for (const o of outcomes) {
        const fmt = o.format || defaultFormat;
        outEls[o.id].textContent = fmt(result[o.id]);
      }
      try {
        window.parent.postMessage(
          { type: 'lever_changed', ts: Date.now(), values: { ...values }, outcomes: result },
          '*',
        );
      } catch (e) { /* not embedded */ }
      if (window.JKAI_EVENTS_URL) {
        fetch(window.JKAI_EVENTS_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ type: 'lever_changed', ts: Date.now(), values: { ...values }, outcomes: result }),
        }).catch(() => {});
      }
    }

    for (const l of levers) {
      const wrap = el('label', 'ex-lever');
      wrap.appendChild(el('span', 'ex-lever-label', l.label));
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(l.min);
      input.max = String(l.max);
      input.step = String(l.step ?? 1);
      input.value = String(l.value);
      input.setAttribute('data-lever', l.id);
      const shown = el('output', 'ex-lever-value', l.value + (l.unit || ''));
      input.addEventListener('input', () => {
        values[l.id] = Number(input.value);
        shown.textContent = input.value + (l.unit || '');
        recompute();
      });
      wrap.appendChild(input);
      wrap.appendChild(shown);
      controls.appendChild(wrap);
    }

    recompute();

    return {
      values,
      set(id, v) {
        const input = controls.querySelector('[data-lever="' + id + '"]');
        if (input) { input.value = String(v); input.dispatchEvent(new Event('input')); }
        else { values[id] = v; recompute(); }
      },
      recompute,
      destroy() { root.remove(); },
    };
  };
})();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/jkai/explainer-kit.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 6: Commit**

```bash
git add static/explainer-kit/tokens.css static/explainer-kit/sim.js src/lib/jkai/explainer-kit.test.ts
git commit -m "feat(studio): explainer kit tokens and lever runtime"
```

---

## Task 2: Explainer kit — causal diagram module

Ported from `src/routes/projects/policy-engine/components/CausalFlow.svelte` (424 lines), reduced to framework-free SVG. Do not invent a new diagram model: read that file first and keep its node/edge vocabulary.

**Files:**
- Create: `static/explainer-kit/diagram.js`
- Modify: `src/lib/jkai/explainer-kit.test.ts`

**Interfaces:**
- Consumes: `window.Explainer` namespace from Task 1
- Produces: `window.Explainer.createDiagram(spec)` where
  `spec = { mount: HTMLElement, nodes: Array<{ id: string, label: string, x: number, y: number, kind?: 'lever'|'mechanism'|'outcome' }>, edges: Array<{ from: string, to: string, weight?: number, label?: string }>, onNodeClick?: (id: string) => void }`
  returns `{ setWeight(from, to, w), highlight(id|null), destroy() }`. Emits an `<svg>` — this is what satisfies studio-gate's visual check on a diagram chapter.

- [ ] **Step 1: Read the precedent**

Run: `sed -n '1,120p' src/routes/projects/policy-engine/components/CausalFlow.svelte`
Note its node kinds, its edge-weight-to-stroke-width mapping, and its animated flow. Reuse them.

- [ ] **Step 2: Add the failing tests**

Append to `src/lib/jkai/explainer-kit.test.ts`, inside the existing `describe`:

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/jkai/explainer-kit.test.ts`
Expected: FAIL — `ENOENT: … 'static/explainer-kit/diagram.js'`

- [ ] **Step 4: Write `static/explainer-kit/diagram.js`**

```js
/* Explainer kit — causal / system diagrams.
 * Ported from policy-engine's CausalFlow.svelte, framework-free.
 * Nodes carry data-node="<id>"; edges carry data-edge="<from>__<to>".
 */
(function () {
  const ns = (window.Explainer = window.Explainer || {});
  const SVG = 'http://www.w3.org/2000/svg';

  const KIND_FILL = {
    lever: 'var(--ex-accent-soft)',
    mechanism: 'var(--ex-surface)',
    outcome: 'var(--ex-ramp-1)',
  };

  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVG, tag);
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
    return n;
  }

  ns.createDiagram = function createDiagram(spec) {
    const mount = spec.mount;
    if (!mount) throw new Error('createDiagram: spec.mount is required');
    const nodes = spec.nodes || [];
    const edges = spec.edges || [];
    const byId = {};
    for (const n of nodes) byId[n.id] = n;

    const w = spec.width || 720;
    const h = spec.height || 380;
    const svg = svgEl('svg', {
      viewBox: `0 0 ${w} ${h}`,
      width: '100%',
      role: 'img',
      'aria-label': spec.title || 'Causal diagram',
    });

    const defs = svgEl('defs', {});
    const marker = svgEl('marker', {
      id: 'ex-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5',
      markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse',
    });
    marker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--ex-ink-soft)' }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    const edgeLayer = svgEl('g', { class: 'ex-edges' });
    const nodeLayer = svgEl('g', { class: 'ex-nodes' });
    svg.appendChild(edgeLayer);
    svg.appendChild(nodeLayer);

    const edgeEls = {};
    for (const e of edges) {
      const a = byId[e.from];
      const b = byId[e.to];
      if (!a || !b) continue;
      const key = e.from + '__' + e.to;
      const line = svgEl('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: 'var(--ex-ink-soft)',
        'stroke-width': Math.max(1, Math.min(8, (e.weight ?? 1) * 3)),
        'marker-end': 'url(#ex-arrow)',
        'data-edge': key,
      });
      edgeLayer.appendChild(line);
      edgeEls[key] = line;
      if (e.label) {
        const t = svgEl('text', {
          x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 6,
          'text-anchor': 'middle', fill: 'var(--ex-ink-soft)',
          'font-size': '11', 'font-family': 'var(--font-mono)',
        });
        t.textContent = e.label;
        edgeLayer.appendChild(t);
      }
    }

    for (const n of nodes) {
      const g = svgEl('g', { 'data-node': n.id, class: 'ex-node', tabindex: '0' });
      g.appendChild(svgEl('rect', {
        x: n.x - 68, y: n.y - 20, width: 136, height: 40, rx: 2,
        fill: KIND_FILL[n.kind] || 'var(--ex-surface)',
        stroke: 'var(--ex-ink)', 'stroke-width': 1,
      }));
      const t = svgEl('text', {
        x: n.x, y: n.y + 4, 'text-anchor': 'middle',
        fill: 'var(--ex-ink)', 'font-size': '12', 'font-family': 'var(--font-body)',
      });
      t.textContent = n.label;
      g.appendChild(t);
      if (spec.onNodeClick) {
        g.style.cursor = 'pointer';
        g.addEventListener('click', () => spec.onNodeClick(n.id));
      }
      nodeLayer.appendChild(g);
    }

    mount.appendChild(svg);

    return {
      setWeight(from, to, weight) {
        const line = edgeEls[from + '__' + to];
        if (line) line.setAttribute('stroke-width', String(Math.max(1, Math.min(8, weight * 3))));
      },
      highlight(id) {
        nodeLayer.querySelectorAll('[data-node]').forEach((g) => {
          const on = id != null && g.getAttribute('data-node') === id;
          g.querySelector('rect').setAttribute('stroke-width', on ? '3' : '1');
        });
      },
      destroy() { svg.remove(); },
    };
  };
})();
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/jkai/explainer-kit.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 6: Commit**

```bash
git add static/explainer-kit/diagram.js src/lib/jkai/explainer-kit.test.ts
git commit -m "feat(studio): causal diagram module ported from CausalFlow"
```

---

## Task 3: Explainer kit — low-poly scene module

This is the SimCity register John asked for. three.js is vendored, not CDN-loaded: a published bundle under `/projects/<slug>/` must not depend on a third party staying up.

**Files:**
- Create: `static/explainer-kit/three.min.js`
- Create: `static/explainer-kit/lowpoly.js`
- Modify: `src/lib/jkai/explainer-kit.test.ts`

**Interfaces:**
- Consumes: `window.THREE` from the vendored bundle; `window.Explainer` namespace
- Produces: `window.Explainer.createScene(spec)` where
  `spec = { mount: HTMLElement, cols: number, rows: number, tiles: Array<{ col: number, row: number, height: number, ramp: 0|1|2|3|4, label?: string }>, onTileClick?: (tile) => void }`
  returns `{ setTiles(tiles), destroy() }`. Renders a `<canvas>` — this is what satisfies studio-gate's visual check on a scene chapter.

- [ ] **Step 1: Vendor three.js**

```bash
curl -sL https://unpkg.com/three@0.169.0/build/three.min.js -o static/explainer-kit/three.min.js
ls -la static/explainer-kit/three.min.js   # expect ~600-700KB, non-zero
node -e "const s=require('fs').readFileSync('static/explainer-kit/three.min.js','utf8'); if(!/REVISION/.test(s)) throw new Error('not three.js'); console.log('ok')"
```

If unpkg is unreachable, use `https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.min.js`. Record the version in `README.md` (Task 4).

- [ ] **Step 2: Add the failing tests**

Append to `src/lib/jkai/explainer-kit.test.ts`:

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/jkai/explainer-kit.test.ts`
Expected: FAIL — `ENOENT: … 'static/explainer-kit/lowpoly.js'`

- [ ] **Step 4: Write `static/explainer-kit/lowpoly.js`**

```js
/* Explainer kit — low-poly isometric scene.
 * A tile grid of extruded blocks. Height and colour carry two variables;
 * clicking a tile inspects it. Requires three.min.js loaded first.
 *
 * The canvas carries data-scene so studio-gate's visual check can find it.
 */
(function () {
  const ns = (window.Explainer = window.Explainer || {});

  const RAMP = ['--ex-ramp-0', '--ex-ramp-1', '--ex-ramp-2', '--ex-ramp-3', '--ex-ramp-4'];

  function tokenColour(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return new window.THREE.Color(v || fallback);
  }

  ns.createScene = function createScene(spec) {
    const THREE = window.THREE;
    if (!THREE) throw new Error('createScene: three.min.js must be loaded first');
    const mount = spec.mount;
    if (!mount) throw new Error('createScene: spec.mount is required');

    const cols = spec.cols || 8;
    const rows = spec.rows || 8;
    const width = mount.clientWidth || 720;
    const height = spec.height || 420;

    const scene = new THREE.Scene();
    scene.background = tokenColour('--ex-bg', '#faf8f4');

    const aspect = width / height;
    const frustum = Math.max(cols, rows) * 0.85;
    const camera = new THREE.OrthographicCamera(
      -frustum * aspect, frustum * aspect, frustum, -frustum, 0.1, 1000,
    );
    camera.position.set(cols, Math.max(cols, rows), rows);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.domElement.setAttribute('data-scene', spec.id || 'scene');
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(6, 12, 8);
    scene.add(key);

    const group = new THREE.Group();
    scene.add(group);

    const geometry = new THREE.BoxGeometry(0.9, 1, 0.9);
    let meshes = [];

    function clear() {
      for (const m of meshes) { group.remove(m); m.material.dispose(); }
      meshes = [];
    }

    function setTiles(tiles) {
      clear();
      for (const t of tiles || []) {
        const h = Math.max(0.05, t.height ?? 0.2);
        const colour = tokenColour(RAMP[Math.min(4, Math.max(0, t.ramp ?? 0))], '#d9a86e');
        const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: colour }));
        mesh.position.set(t.col - cols / 2, h / 2, t.row - rows / 2);
        mesh.scale.y = h;
        mesh.userData = t;
        group.add(mesh);
        meshes.push(mesh);
      }
      renderer.render(scene, camera);
    }

    if (spec.onTileClick) {
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      renderer.domElement.addEventListener('click', (ev) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(meshes)[0];
        if (hit) spec.onTileClick(hit.object.userData);
      });
    }

    setTiles(spec.tiles);

    return {
      setTiles,
      destroy() { clear(); geometry.dispose(); renderer.dispose(); renderer.domElement.remove(); },
    };
  };
})();
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/jkai/explainer-kit.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 6: Commit**

```bash
git add static/explainer-kit/three.min.js static/explainer-kit/lowpoly.js src/lib/jkai/explainer-kit.test.ts
git commit -m "feat(studio): low-poly isometric scene module on vendored three.js"
```

---

## Task 4: Explainer kit — charts, docs, and the worked chapter example

The worked example is the piece that actually changes agent behaviour. It replaces the admin list page the agent currently learns from, and it must pass the very linter it teaches — that is the `design_lint_loop` regression guard.

**Files:**
- Create: `static/explainer-kit/chart.js`
- Create: `static/explainer-kit/README.md`
- Create: `static/explainer-kit/scenes.md`
- Create: `static/explainer-kit/examples/chapter.html`
- Modify: `src/lib/jkai/explainer-kit.test.ts`

**Interfaces:**
- Produces: `window.Explainer.createChart(spec)` where
  `spec = { mount: HTMLElement, kind: 'line'|'bar', series: Array<{ id: string, label: string, points: Array<{ x: number, y: number }> }>, xLabel?: string, yLabel?: string }`
  returns `{ update(series), destroy() }`. Renders `<svg>`.

- [ ] **Step 1: Add the failing tests**

Append to `src/lib/jkai/explainer-kit.test.ts`:

```ts
  it('chart.js exposes createChart', async () => {
    const js = await read('chart.js');
    expect(js).toMatch(/createChart/);
    expect(js).toContain('http://www.w3.org/2000/svg');
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

  it('the worked chapter example declares the contract studio-gate drives', async () => {
    const html = await read('examples/chapter.html');
    expect(html).toContain('data-chapter');
    expect(html).toContain('data-lever');
    expect(html).toContain('data-outcome');
    expect(html).toContain('data-citation');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/jkai/explainer-kit.test.ts`
Expected: FAIL — `ENOENT: … 'static/explainer-kit/chart.js'`

- [ ] **Step 3: Write `static/explainer-kit/chart.js`**

```js
/* Explainer kit — charts. Line and bar only; six series maximum.
 * Colours come from --ex-cat-N so the whole project reads as one system.
 */
(function () {
  const ns = (window.Explainer = window.Explainer || {});
  const SVG = 'http://www.w3.org/2000/svg';
  const CAT = ['--ex-cat-1', '--ex-cat-2', '--ex-cat-3', '--ex-cat-4', '--ex-cat-5', '--ex-cat-6'];

  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVG, tag);
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
    return n;
  }

  ns.createChart = function createChart(spec) {
    const mount = spec.mount;
    if (!mount) throw new Error('createChart: spec.mount is required');
    const w = spec.width || 640;
    const h = spec.height || 300;
    const pad = { top: 16, right: 16, bottom: 34, left: 48 };

    const svg = svgEl('svg', {
      viewBox: `0 0 ${w} ${h}`, width: '100%', role: 'img',
      'aria-label': spec.title || 'Chart',
    });
    mount.appendChild(svg);

    function draw(series) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const all = series.flatMap((s) => s.points);
      if (!all.length) return;
      const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(0, Math.min(...ys)), y1 = Math.max(...ys);
      const sx = (x) => pad.left + ((x - x0) / (x1 - x0 || 1)) * (w - pad.left - pad.right);
      const sy = (y) => h - pad.bottom - ((y - y0) / (y1 - y0 || 1)) * (h - pad.top - pad.bottom);

      svg.appendChild(svgEl('line', {
        x1: pad.left, y1: h - pad.bottom, x2: w - pad.right, y2: h - pad.bottom,
        stroke: 'var(--ex-rule)', 'stroke-width': 1,
      }));
      svg.appendChild(svgEl('line', {
        x1: pad.left, y1: pad.top, x2: pad.left, y2: h - pad.bottom,
        stroke: 'var(--ex-rule)', 'stroke-width': 1,
      }));

      series.forEach((s, i) => {
        const colour = `var(${CAT[i % CAT.length]})`;
        if (spec.kind === 'bar') {
          const bw = Math.max(2, (w - pad.left - pad.right) / (s.points.length * series.length + 1));
          s.points.forEach((p, j) => {
            svg.appendChild(svgEl('rect', {
              x: sx(p.x) + i * bw - bw / 2, y: sy(p.y),
              width: bw, height: Math.max(0, h - pad.bottom - sy(p.y)),
              fill: colour, 'data-series': s.id,
            }));
          });
        } else {
          const d = s.points.map((p, j) => `${j ? 'L' : 'M'}${sx(p.x)},${sy(p.y)}`).join(' ');
          svg.appendChild(svgEl('path', {
            d, fill: 'none', stroke: colour, 'stroke-width': 2, 'data-series': s.id,
          }));
        }
      });
    }

    draw(spec.series || []);
    return { update: draw, destroy() { svg.remove(); } };
  };
})();
```

- [ ] **Step 4: Write `static/explainer-kit/README.md`**

````markdown
# Explainer kit

Read-only. Mounted at `./explainer-kit/` in your workspace. Copy the files you
need into your project and reference them with `<script src="...">`; do not
edit the mount — it is regenerated every iteration and any change you make to
it is discarded.

Pinned dependency: `three@0.169.0` (`three.min.js`, vendored — do NOT add a CDN
`<script>` tag for three.js, and do NOT `npm install three`).

## Files

| File | What it gives you |
|---|---|
| `tokens.css` | The palette. Import at the root of every stylesheet. Raw hex is legal in this file and nowhere else in your project. |
| `sim.js` | `Explainer.createSim` — declare levers plus a step function, get controls and a live outcome readout. |
| `diagram.js` | `Explainer.createDiagram` — causal/system diagrams in SVG. |
| `lowpoly.js` | `Explainer.createScene` — isometric low-poly tile scene (needs `three.min.js`). |
| `chart.js` | `Explainer.createChart` — line and bar. |
| `scenes.md` | Which module suits which kind of concept. Read this before choosing. |
| `examples/chapter.html` | A complete chapter. Copy its structure. |

## The chapter contract

Every chapter page you build MUST:

1. Give its root element `data-chapter="<n>"`, numbered from 1.
2. Contain at least one `<canvas>` or `<svg>` produced by this kit. A chapter
   of prose and a table is rejected.
3. Contain at least one control tagged `data-lever="<id>"` whose change updates
   an element tagged `data-outcome="<id>"`. `createSim` does both for you.
4. Contain at least one `<a data-citation href="<url>">` whose URL appears in
   the research brief.

These four are checked automatically after every iteration. They are not style
advice — a chapter that misses one is sent back with the specific chapter named.

## Rules

- Never hard-code a colour or a font name. Always `var(--ex-…)` or `var(--font-…)`.
- No Tailwind, and no class attribute containing `flex`, `grid`, `bg-`, `text-`,
  `p-<digit>`, `m-<digit>`, `w-<digit>` or `h-<digit>` as a whole word. Note that
  `chapter-grid` counts as `grid` — pick another name.
- Six categorical colours maximum. If you need more, the chart is wrong.
````

- [ ] **Step 5: Write `static/explainer-kit/scenes.md`**

````markdown
# Scene grammar — which mode for which concept

Pick per chapter, not per project. A good project usually uses three of the four.

| The concept is… | Use | Why |
|---|---|---|
| A system where a few inputs drive an outcome through named mechanisms | `createSim` + `createDiagram` | The diagram shows the causal path; the levers let the learner feel it. This is the default for a policy or process. |
| Spatially distributed, or about density, allocation and place | `createScene` | Extruded tiles read as quantity-in-place instantly. This is the SimCity register: one variable as height, one as colour. |
| A quantity changing over time, or a comparison across categories | `createChart` | Do not build a 3D scene for a time series. |
| A sequence of stages with gates, queues or dropout between them | `createDiagram` with `kind: 'mechanism'` nodes and weighted edges | Edge weight carries the flow; `setWeight` animates it as a lever moves. |

## Anti-patterns

- **A scene for the sake of a scene.** If height and colour carry nothing, use a chart.
- **A diagram that just restates the nav.** Boxes named after your own chapters teach nothing.
- **Levers with no consequence.** A slider that changes a number nobody explained is decoration. Every lever must move an outcome the chapter has already given meaning to.
- **Six charts in a row.** One idea per chapter.

## Sequencing chapters

Order chapters so each one can only be understood after the last. Aim for 6–10.
A workable spine: what the thing is → what drives it → the mechanism in the
middle → what happens when you push it → where it breaks → what is actually
uncertain. The last chapter should name the gaps from the research brief
honestly rather than closing on false confidence.
````

- [ ] **Step 6: Write `static/explainer-kit/examples/chapter.html`**

Check every class name against the forbidden list before writing. No `grid`, no `flex`, no `text-`, no raw hex, no bare `font-family:`, no `href="#<3-8 hex chars>"`.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Chapter 3 — How the funding formula reaches a school</title>
<link rel="stylesheet" href="../tokens.css" />
<style>
  body {
    background: var(--ex-bg);
    color: var(--ex-ink);
    font-family: var(--font-body);
    margin: 0;
  }
  .chapter { max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem 5rem; }
  .kicker {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ex-accent);
  }
  h1 { font-family: var(--font-display); font-size: 2rem; line-height: 1.05; margin: 0.3rem 0 1rem; }
  .lede { font-size: 1.1rem; color: var(--ex-ink-soft); max-width: 62ch; }
  .panel {
    background: var(--ex-surface);
    border: 1px solid var(--ex-rule);
    border-radius: var(--ex-radius);
    padding: 1.25rem;
    margin: 2rem 0;
  }
  .sources { border-top: 1px solid var(--ex-rule); padding-top: 1rem; margin-top: 3rem; }
  .sources a { color: var(--ex-accent); }
</style>
</head>
<body>
<article class="chapter" data-chapter="3">
  <p class="kicker">Chapter 3</p>
  <h1>How the funding formula reaches a school</h1>
  <p class="lede">
    Two schools with the same number of pupils can receive materially different
    budgets. The difference is not discretion — it is four factors applied in a
    fixed order. This chapter lets you apply them yourself.
  </p>

  <!-- Visual: the causal path, before the learner touches anything. -->
  <div class="panel" id="causal"></div>

  <!-- Manipulate + consequence: createSim renders both halves. -->
  <div class="panel" id="sim"></div>

  <p>
    Notice what happens when deprivation weighting rises while the basic entitlement
    holds: the total moves less than most people expect, because the weighting applies
    to a minority of the roll. That gap between expectation and arithmetic is the point
    of this chapter.
  </p>

  <footer class="sources">
    <p class="kicker">Sources</p>
    <p>
      <a data-citation href="https://www.gov.uk/government/publications/national-funding-formula-tables-for-schools-and-high-needs">
        National funding formula tables for schools and high needs, DfE
      </a>
    </p>
  </footer>
</article>

<script src="../diagram.js"></script>
<script src="../sim.js"></script>
<script>
  const diagram = window.Explainer.createDiagram({
    mount: document.getElementById('causal'),
    title: 'From pupil count to school budget',
    nodes: [
      { id: 'roll', label: 'Pupils on roll', x: 90, y: 60, kind: 'lever' },
      { id: 'basic', label: 'Basic entitlement', x: 330, y: 60, kind: 'mechanism' },
      { id: 'depriv', label: 'Deprivation weight', x: 330, y: 180, kind: 'mechanism' },
      { id: 'budget', label: 'School budget', x: 600, y: 120, kind: 'outcome' },
    ],
    edges: [
      { from: 'roll', to: 'basic', weight: 1.4 },
      { from: 'roll', to: 'depriv', weight: 0.6 },
      { from: 'basic', to: 'budget', weight: 1.8 },
      { from: 'depriv', to: 'budget', weight: 0.7 },
    ],
  });

  window.Explainer.createSim({
    mount: document.getElementById('sim'),
    levers: [
      { id: 'roll', label: 'Pupils on roll', min: 100, max: 1800, step: 10, value: 640 },
      { id: 'fsm', label: 'Share eligible for free school meals', min: 0, max: 60, step: 1, value: 22, unit: '%' },
      { id: 'rate', label: 'Deprivation weighting per eligible pupil', min: 0, max: 1400, step: 50, value: 500, unit: '£' },
    ],
    outcomes: [
      { id: 'basic', label: 'Basic entitlement', unit: '£' },
      { id: 'uplift', label: 'Deprivation uplift', unit: '£' },
      { id: 'total', label: 'Total budget', unit: '£' },
    ],
    step: (v) => {
      const basic = v.roll * 4610;
      const uplift = v.roll * (v.fsm / 100) * v.rate;
      diagram.setWeight('depriv', 'budget', Math.max(0.2, (uplift / (basic + uplift)) * 6));
      return { basic, uplift, total: basic + uplift };
    },
  });
</script>
</body>
</html>
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/lib/jkai/explainer-kit.test.ts`
Expected: PASS — 14 tests. If `the worked chapter example passes the design linter it teaches` fails, read the finding and rename the offending class or token; do not weaken the linter.

- [ ] **Step 8: Commit**

```bash
git add static/explainer-kit/ src/lib/jkai/explainer-kit.test.ts
git commit -m "feat(studio): charts, scene grammar, and a worked chapter that lints clean"
```

---

## Task 5: Mount the kit and stop the linter eating its own reference

**Files:**
- Modify: `src/lib/jkai/design-lint.ts` (the `DESIGN_MOUNT_RE` const)
- Modify: `src/lib/jkai/design-assets.ts` (add `buildExplainerAssets`)
- Modify: `src/lib/jkai/sandbox.ts` (add `syncExplainerKit` after `syncDesignAssets`, ~line 640)
- Modify: `src/lib/jkai/design-lint.test.ts`

**Interfaces:**
- Consumes: `lintDesignSystem(files)` from Task 1's test usage
- Produces:
  - `buildExplainerAssets(repoRoot: string): Promise<Record<string, string>>` — same shape as `buildDesignAssets`, keys relative to the mount root
  - `syncExplainerKit(buildId: string): Promise<string>` — returns the mount path `/home/jkai/workspace/<id>/dev/explainer-kit`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/jkai/design-lint.test.ts`:

```ts
import { lintDesignSystem } from './design-lint';

describe('read-only mounts are exempt', () => {
  it('never reports a finding inside explainer-kit/', () => {
    const { findings } = lintDesignSystem({
      'explainer-kit/examples/chapter.html': '<div class="grid" style="color:#ff0000">x</div>',
      'explainer-kit/tokens.css': 'body { font-family: Helvetica; }',
    });
    expect(findings).toEqual([]);
  });

  it('still reports the same violations outside the mount', () => {
    const { findings } = lintDesignSystem({
      'src/chapter.html': '<div class="grid" style="color:#ff0000">x</div>',
    });
    expect(findings.map((f) => f.rule).sort()).toEqual(['no-raw-hex', 'no-tailwind']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/jkai/design-lint.test.ts`
Expected: FAIL — the first test reports 3 findings inside the mount.

- [ ] **Step 3: Widen the mount exemption**

In `src/lib/jkai/design-lint.ts`, replace the `DESIGN_MOUNT_RE` declaration (keep the comment block above it, and add the second sentence):

```ts
/**
 * …existing comment retained…
 *
 * `explainer-kit/` is the second such mount (Studio builds) and carries exactly
 * the same hazard: it is read-only, regenerated every iteration, and contains a
 * worked example the agent is told to copy. A finding there cannot be fixed.
 */
const DESIGN_MOUNT_RE = /(^|\/)(design-system|explainer-kit)\//i;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/jkai/design-lint.test.ts`
Expected: PASS

- [ ] **Step 5: Add `buildExplainerAssets` to `design-assets.ts`**

Append to `src/lib/jkai/design-assets.ts`:

```ts
/**
 * The Studio mount. Unlike `buildDesignAssets` — which inlines its content as
 * string constants — the explainer kit is real, testable JavaScript, so it is
 * read from disk. `static/` is copied to `build/client/` by the adapter and
 * `build/` is rsynced wholesale by ci-deploy, so both paths resolve. Same
 * two-candidate pattern `syncJkaiExtension` already uses for jkai-tools.js.
 */
const EXPLAINER_FILES = [
  'tokens.css',
  'sim.js',
  'diagram.js',
  'lowpoly.js',
  'chart.js',
  'three.min.js',
  'README.md',
  'scenes.md',
  'examples/chapter.html',
];

export async function buildExplainerAssets(repoRoot: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const rel of EXPLAINER_FILES) {
    const candidates = [
      path.join(repoRoot, 'static/explainer-kit', rel),
      path.join(repoRoot, 'build/client/explainer-kit', rel),
    ];
    let body: string | null = null;
    for (const c of candidates) {
      body = await readFile(c, 'utf-8').catch(() => null);
      if (body != null) break;
    }
    if (body == null) missing.push(rel);
    else out[rel] = body;
  }
  if (missing.length > 0) {
    // Fail loudly. A half-mounted kit gives the agent a README promising modules
    // that are not there, and it will spend an iteration discovering that.
    throw new Error(`buildExplainerAssets: missing ${missing.join(', ')} under static/ and build/client/`);
  }
  return out;
}
```

- [ ] **Step 6: Add `syncExplainerKit` to `sandbox.ts`**

Insert directly after the closing brace of `syncDesignAssets` (around line 640):

```ts
export async function syncExplainerKit(buildId: string): Promise<string> {
  const { buildExplainerAssets } = await import('./design-assets');
  const dest = `/home/jkai/workspace/${buildId}/dev/explainer-kit`;
  if (HOST_MODE) {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(`${dest}/examples`, { recursive: true });
  } else {
    await execInSandbox(`mkdir -p ${dest}/examples`);
  }
  const assets = await buildExplainerAssets(process.cwd());
  let written = 0;
  let failed = 0;
  for (const [rel, body] of Object.entries(assets)) {
    const r = await writeFileInSandbox(`${dest}/${rel}`, body);
    if (r.exitCode === 0) written++;
    else failed++;
  }
  if (failed > 0) {
    throw new Error(`syncExplainerKit: ${failed}/${written + failed} writes failed (dest=${dest})`);
  }
  return dest;
}
```

- [ ] **Step 7: Verify the whole kit round-trips**

Run: `npx vitest run src/lib/jkai/design-lint.test.ts src/lib/jkai/explainer-kit.test.ts`
Expected: PASS
Run: `node -e "import('./src/lib/jkai/design-assets.ts')" 2>/dev/null || npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'design-assets|sandbox' || echo 'no type errors in touched files'`
Expected: no type errors naming `design-assets.ts` or `sandbox.ts`

- [ ] **Step 8: Commit**

```bash
git add src/lib/jkai/design-lint.ts src/lib/jkai/design-lint.test.ts src/lib/jkai/design-assets.ts src/lib/jkai/sandbox.ts
git commit -m "feat(studio): mount the explainer kit and exempt it from the linter"
```

---

## Task 6: The studio system prompt

The single highest-leverage change in this plan. `SYSTEM_PROMPT` currently hard-stops the agent the moment one route returns 200 and tells it to prefer three empty pages to one good one.

**Files:**
- Modify: `src/lib/jkai/prompt.ts`
- Test: `src/lib/jkai/prompt.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces: `BuildPromptMode` becomes `'app' | 'repo' | 'studio'`; `buildSystemPrompt(buildId, assignedPort, mode)` returns the studio prompt for `'studio'`; `buildIterationContext(..., mode, gateCommand, chapterPlan?)` gains an optional 10th parameter `chapterPlan: Array<{ n: number; title: string; leverId: string; outcomeId: string }> | null = null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/jkai/prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildIterationContext } from './prompt';

describe('studio prompt mode', () => {
  const p = buildSystemPrompt('b1', 8123, 'studio');

  it('does not carry the app mode wrap-up-at-200 hard stop', () => {
    expect(p).not.toContain('at least one route returns a 200. → Wrap up');
    expect(p).not.toContain("You've been working for 15 minutes");
  });

  it('does not recommend Tailwind, which the linter rejects', () => {
    expect(p).not.toMatch(/cdn\.tailwindcss\.com/);
  });

  it('states the four-part chapter contract', () => {
    expect(p).toContain('data-chapter');
    expect(p).toContain('data-lever');
    expect(p).toContain('data-outcome');
    expect(p).toContain('data-citation');
  });

  it('points at the explainer kit mount', () => {
    expect(p).toContain('./explainer-kit/');
    expect(p).toContain('scenes.md');
  });

  it('still carries the port and workspace footer', () => {
    expect(p).toContain('/home/jkai/workspace/b1/dev');
    expect(p).toContain('8123');
  });

  it('leaves app and repo modes untouched', () => {
    expect(buildSystemPrompt('b1', 8123, 'app')).toContain('SHIP THE THINNEST RUNNABLE PREVIEW');
    expect(buildSystemPrompt('b1', 8123, 'repo')).toContain('THE DELIVERABLE IS A REVIEWABLE DIFF');
  });

  it('injects the chapter plan into iteration context', () => {
    const msgs = buildIterationContext(
      'explain school funding', null, '', null, 4, 8123, '', 'studio', null,
      [{ n: 1, title: 'What a school budget is', leverId: 'roll', outcomeId: 'total' }],
    );
    expect(msgs[0].content).toContain('Chapter Plan');
    expect(msgs[0].content).toContain('What a school budget is');
    expect(msgs[0].content).toContain('Iteration 4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/jkai/prompt.test.ts`
Expected: FAIL — `Argument of type '"studio"' is not assignable to parameter of type 'BuildPromptMode'`

- [ ] **Step 3: Add `STUDIO_SYSTEM_PROMPT` to `prompt.ts`**

Insert after `REPO_SYSTEM_PROMPT`, before `export type BuildPromptMode`:

```ts
/**
 * Studio mode — multi-chapter interactive explainers.
 *
 * The app prompt above is tuned for time-to-first-preview: it hard-stops the
 * agent the moment one route returns 200 and tells it that three empty pages
 * beat one good one. Both are right for a quick prototype and fatal for a
 * learning artefact. This prompt keeps the walking skeleton (proving the deploy
 * loop early is genuinely valuable) and then trades breadth for depth: one
 * complete chapter per iteration.
 */
const STUDIO_SYSTEM_PROMPT = `You are building an interactive explainer — a multi-chapter learning experience about one subject, for one reader who wants to genuinely understand it.

YOU HAVE REAL TOOLS — use them directly:
- read: open a file
- write: create or overwrite a file
- edit: find/replace within a file
- bash: run shell commands
- grep, find, ls, rg: inspect the workspace

HOST ENVIRONMENT — already installed, do NOT reinstall: Python 3.12, Node 22 + npm/npx, Playwright + Chromium, git, curl, jq, ripgrep, bash + coreutils. Before any \`npm install\` or \`pip install\`, check you don't already have the capability.

THE EXPLAINER KIT IS MOUNTED AT ./explainer-kit/ — READ IT FIRST.
Before writing any HTML, CSS or JavaScript:
1. Read \`./explainer-kit/README.md\` in full.
2. Read \`./explainer-kit/scenes.md\` — it tells you which visual mode suits which kind of concept. Choose per chapter.
3. Read \`./explainer-kit/examples/chapter.html\` — copy its structure.
4. Copy the kit files your project needs into your own tree and reference them with <script src>. Never edit the mount; it is regenerated every iteration and your edits are discarded.
5. Import \`tokens.css\` at the root of your stylesheet. Never hard-code a colour or a font name.
6. three.js is vendored at \`./explainer-kit/three.min.js\`. Do NOT add a CDN script tag for it and do NOT npm install it.
7. Do NOT use Tailwind. A post-iteration linter rejects any class attribute containing bg-, text-, p-<digit>, m-<digit>, w-<digit>, h-<digit>, flex or grid as a whole word. Note that a class named "chapter-grid" matches — pick another name.

THE CHAPTER CONTRACT — every chapter page must have all four:
1. A root element with \`data-chapter="<n>"\`, numbered from 1.
2. At least one <canvas> or <svg> produced by the kit. Prose and a table is not a chapter.
3. At least one control tagged \`data-lever="<id>"\` whose change visibly updates an element tagged \`data-outcome="<id>"\`. \`Explainer.createSim\` gives you both.
4. At least one \`<a data-citation href="...">\` pointing at a real source from the research brief.

All four are checked automatically after every iteration by a headless browser that actually drives your controls. A chapter missing one comes back named, with the remedy. These are not style notes.

EXPLAIN → MANIPULATE → CONSEQUENCE. That is the shape of every chapter. Say what the thing is; let the reader change something; show them what that did. A slider that moves a number nobody has given meaning to is decoration, and decoration is the failure mode this whole format exists to avoid.

SCOPE OF AN ITERATION — ONE COMPLETE CHAPTER:
- Iteration 1 is the skeleton: serve.json, the navigation shell, and every chapter from the plan existing as a reachable route with its title and a one-line placeholder. Nothing more. Get it serving 200 and stop.
- Every iteration after that delivers ONE chapter, complete: its narrative, its visual, its interactive model, its citations. Not a slice of three chapters. Not a scaffold. One chapter a reader could learn from.
- Do not move on to chapter N+1 while chapter N is stubbed.
- Take the time a chapter needs. There is no bonus for finishing early here, and a half-built chapter costs the next iteration more than it saved this one.

SERVING:
Write a serve.json at the workspace root in iteration 1, before any feature code:

{
  "port": <assigned port, see below>,
  "startCommand": "<command that starts the server and binds 0.0.0.0>",
  "healthCheck": "/<path that returns 200 when ready>",
  "description": "<one-line description>"
}

Bind 0.0.0.0, not 127.0.0.1. Any TCP server works — python3 -m http.server, Express, Flask, FastAPI. Chapters must be real routes (e.g. /chapter-3/ or /chapter/3), each returning 200 on its own.

WORKSPACE LAYOUT:
- /home/jkai/workspace/BUILD_ID/dev  — your working directory. Edit here.
- /home/jkai/workspace/BUILD_ID/live — what the user sees, promoted from dev after each iteration.

EVIDENCE:
- Your research brief is in the context below. Every factual claim you render must trace to a fact in it. If you need something the brief does not have, say so in ## Evaluation rather than inventing a figure.
- Real data only. Where the brief names a dataset or API, use it.
- The brief's GAPS section is not a failure — the final chapter should tell the reader honestly what is not known.

TESTING:
- No tests in the skeleton iteration.
- Once chapters are landing, keep a tests/ directory and a tests/run.sh with the command to run them. Python → pytest, Node → node:test. Only write tests you have seen pass.

ERROR RECOVERY: if a tool call fails, diagnose before retrying. Never re-run the same command hoping for different output. Stuck after two attempts, change approach.

DATA EMISSION:
The proxy injects window.JKAI_BUILD_ID and window.JKAI_EVENTS_URL into every served page. \`Explainer.createSim\` already emits \`lever_changed\` for you. On top of that, emit \`chapter_viewed\` when a chapter loads:

  const send = (type, payload) => {
    try { window.parent.postMessage({ type, ts: Date.now(), ...payload }, '*'); } catch {}
    if (window.JKAI_EVENTS_URL) {
      fetch(window.JKAI_EVENTS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ type, ts: Date.now(), ...payload }),
      }).catch(() => {});
    }
  };
  send('chapter_viewed', { chapter: 3 });

Fire-and-forget, never awaited, always wrapped so a published copy with no events URL still works.

WHEN YOU WRAP (every iteration), finish with exactly this structure:

## Evaluation
Which chapter you completed, whether it satisfies all four contract points, what is still stubbed, and any claim you could not source. Estimate completion as chapters-done / chapters-planned.

## Next Steps
Ordered and concrete. Name the next chapter by number and title.`;
```

- [ ] **Step 4: Widen the mode type and the two exported functions**

In `src/lib/jkai/prompt.ts`:

```ts
export type BuildPromptMode = 'app' | 'repo' | 'studio';
```

In `buildSystemPrompt`, add before the `repo` branch:

```ts
  if (mode === 'studio') {
    return (
      STUDIO_SYSTEM_PROMPT +
      `\n\n---\n\nYour workspace: /home/jkai/workspace/${buildId}/dev` +
      `\nYour assigned server port: ${assignedPort} (use this in serve.json and your startCommand)`
    );
  }
```

In `buildIterationContext`, add the parameter and the block. The signature becomes:

```ts
export function buildIterationContext(
  userPrompt: string,
  previousIteration: JkaiIteration | null,
  fileList: string,
  projectPlan: string | null = null,
  iterationNumber: number = 1,
  assignedPort: number = 8000,
  codebaseDigest: string = '',
  mode: BuildPromptMode = 'app',
  gateCommand: string | null = null,
  chapterPlan: Array<{ n: number; title: string; leverId: string; outcomeId: string }> | null = null,
): Array<{ role: 'user' | 'assistant'; content: string }> {
```

Replace the final `if (mode === 'repo') { … } else { … }` with a three-way branch. The `repo` branch is unchanged; the `else` becomes:

```ts
  } else if (mode === 'studio') {
    if (chapterPlan && chapterPlan.length > 0) {
      const rows = chapterPlan
        .map((c) => `${c.n}. ${c.title} — lever \`${c.leverId}\` drives outcome \`${c.outcomeId}\``)
        .join('\n');
      contextMessage += `\n\n## Chapter Plan\n${rows}\n\nEvery chapter is a reachable route with \`data-chapter="<n>"\` on its root element. The lever and outcome ids above are what the post-iteration gate drives — use exactly those ids.`;
    }
    contextMessage += `\n\n## Assigned Serving Port\nYour server must bind to port ${assignedPort}. Reflect this in serve.json.`;
    contextMessage += `\n\nBegin iteration ${iterationNumber}. ${
      iterationNumber === 1
        ? 'This is the skeleton: serve.json, the navigation shell, and every chapter reachable with its title and a one-line placeholder. Nothing more.'
        : 'Deliver ONE complete chapter — narrative, visual, interactive model, citations. Do not start the next one.'
    } Close with ## Evaluation and ## Next Steps.`;
  } else {
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/jkai/prompt.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 6: Commit**

```bash
git add src/lib/jkai/prompt.ts src/lib/jkai/prompt.test.ts
git commit -m "feat(studio): studio system prompt and chapter-aware iteration context"
```

---

## Task 7: Schema — research brief, chapter plan, studio origin

**Files:**
- Modify: `src/lib/db/schema.ts` (`jkaiBuilds`, ~line 619–691)

**Interfaces:**
- Produces: on `JkaiBuild` —
  - `researchBrief: ResearchBrief | null` (jsonb)
  - `chapterPlan: Array<{ n: number; title: string; leverId: string; outcomeId: string }>` (jsonb, default `[]`)
  - `origin: 'manual' | 'hermes' | 'forge' | 'studio'`

  where `ResearchBrief` is defined in Task 10 and imported as a type only.

- [ ] **Step 1: Add the columns**

In `src/lib/db/schema.ts`, inside `jkaiBuilds`, after the `milestones` column:

```ts
  /**
   * Studio builds only. The FACTS/GAPS brief produced before planning — see
   * src/lib/jkai/research-brief.ts. Injected into the planner and into every
   * iteration; the sourcing gate resolves citations against its fact URLs.
   */
  researchBrief: jsonb('research_brief').$type<import('$lib/jkai/research-brief').ResearchBrief | null>().default(null),
  /**
   * Studio builds only. The chapter spine. `leverId`/`outcomeId` are the
   * data-attribute ids studio-gate drives — a chapter with no declared pair
   * cannot be interactivity-checked, and a check that cannot run is a check
   * that silently passes.
   */
  chapterPlan: jsonb('chapter_plan')
    .$type<Array<{ n: number; title: string; leverId: string; outcomeId: string }>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
```

And widen the origin enum:

```ts
  origin: text('origin', { enum: ['manual', 'hermes', 'forge', 'studio'] }).notNull().default('manual'),
```

- [ ] **Step 2: Push the schema**

Run: `npx drizzle-kit push`
Expected: three additive changes, no interactive prompt. These are two new nullable/defaulted columns plus an enum widening — no rename prompt (which would hang a deploy) and no `.unique()` on a populated table.

- [ ] **Step 3: Verify the columns exist**

```bash
psql "$DATABASE_URL" -c "\d jkai_builds" | grep -E 'research_brief|chapter_plan'
```
Expected: both rows present.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(studio): research_brief, chapter_plan columns and studio origin"
```

---

## Task 8: Studio build creator and API route

Mirrors `src/lib/jkai/forge.ts` exactly — read it before writing this.

**Files:**
- Create: `src/lib/jkai/studio.ts`
- Create: `src/lib/jkai/studio.test.ts`
- Create: `src/routes/api/jkai/studio/+server.ts`

**Interfaces:**
- Consumes: `builderClient.startBuild(id)`, `resolveDefaultModel()`, `snapshotPrice(ctx)`
- Produces:
  - `STUDIO_BUDGET: BudgetConfig` (frozen const)
  - `createStudioBuild({ challenge, title? }): Promise<{ buildId: string }>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/jkai/studio.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { STUDIO_BUDGET } from './studio';

describe('studio budget', () => {
  it('allows a chapter-sized iteration without triggering the hourly cooldown', () => {
    // budget.ts counts every iteration in the window, failed ones included.
    // A chapter is a big unit; at the app default of 1M/hour a single 800k
    // chapter would sleep the build for the rest of the hour.
    expect(STUDIO_BUDGET.maxTokensPerHour).toBeGreaterThanOrEqual(3_000_000);
  });

  it('leaves headroom for the skeleton, repairs and a polish pass over 10 chapters', () => {
    expect(STUDIO_BUDGET.maxIterations).toBeGreaterThanOrEqual(20);
  });

  it('caps a single runaway iteration', () => {
    expect(STUDIO_BUDGET.maxTokensPerIteration).toBeGreaterThan(0);
  });

  it('caps total spend in the unit a human reasons about', () => {
    expect(STUDIO_BUDGET.maxCostUsd).toBeGreaterThan(0);
  });

  it('stops an agent that re-verifies forever', () => {
    expect(STUDIO_BUDGET.maxIdleIterations).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/jkai/studio.test.ts`
Expected: FAIL — `Failed to resolve import "./studio"`

- [ ] **Step 3: Write `src/lib/jkai/studio.ts`**

```ts
/**
 * Studio build creator.
 *
 * Mirrors `forge.ts`: one place that creates a preconfigured build so every
 * entry point — the API route, the `studio_build` chat tool, the builds UI —
 * produces an identical row.
 *
 * A Studio build turns a challenge statement into a multi-chapter interactive
 * explainer published at /projects/<slug>/. See
 * docs/superpowers/specs/2026-08-10-jkai-studio-explainer-builds-design.md
 */
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { builderClient } from '$lib/jkai/builder-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { snapshotPrice } from '$lib/server/models/price-snapshot';
import type { BudgetConfig } from './types';

/**
 * Deeper than the app default (25 iterations / 1M tokens per hour / 120 min).
 *
 * The tokens-per-hour rise is the load-bearing change. `checkBudget` sums every
 * iteration in the trailing hour, failed ones included — correctly, after build
 * #126 spent 3.08M tokens across three iterations while only one completed
 * iteration's 490k was visible. But a chapter is a large unit of work, and at
 * 1M/hour a single 800k chapter sleeps the build for the rest of the hour.
 *
 * maxCostUsd is the real backstop and the number to tune: 15 is a first guess,
 * not a measurement. Calibrate on the first three builds.
 */
export const STUDIO_BUDGET: BudgetConfig = Object.freeze({
  maxIterations: 20,
  maxTotalMinutes: 480,
  maxTokensPerHour: 3_000_000,
  maxTokensPerIteration: 900_000,
  activeMinutesPerHour: 50,
  maxCostUsd: 15,
  maxIdleIterations: 3,
});

export async function createStudioBuild({
  challenge,
  title,
}: {
  challenge: string;
  title?: string;
}): Promise<{ buildId: string }> {
  const trimmed = challenge.trim();
  if (!trimmed) throw new Error('createStudioBuild: challenge is required');

  const ctx = await resolveDefaultModel();
  const priceSnapshot = await snapshotPrice(ctx);

  const [build] = await db
    .insert(jkaiBuilds)
    .values({
      title: title?.trim() || `Studio: ${trimmed.slice(0, 60)}`,
      prompt: trimmed,
      origin: 'studio',
      // Design enforcement stays ON. Only the mounted worked example changes —
      // the linter was never the problem, the admin-list-page reference was.
      enforceDesignSystem: true,
      // No human approval gate: the research brief and the plan self-approve.
      planStatus: 'approved',
      budgetConfig: { ...STUDIO_BUDGET },
      chapterPlan: [],
      modelProvider: ctx.provider,
      modelId: ctx.modelId,
      priceSnapshot,
    } as never)
    .returning();

  try {
    await builderClient.startBuild(build.id);
  } catch (err) {
    await db.update(jkaiBuilds).set({ status: 'failed' }).where(eq(jkaiBuilds.id, build.id));
    throw err;
  }

  return { buildId: build.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/jkai/studio.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Write the API route**

Create `src/routes/api/jkai/studio/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOwnerEmail } from '$lib/server/access';
import { createStudioBuild } from '$lib/jkai/studio';

const MAX_CHALLENGE_LEN = 4_000;

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = await locals.auth();
  if (!isOwnerEmail(session?.user?.email)) {
    return json({ error: 'Not found' }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const challenge = typeof body.challenge === 'string' ? body.challenge : '';
  if (!challenge.trim()) {
    return json({ error: 'challenge is required' }, { status: 400 });
  }
  if (challenge.length > MAX_CHALLENGE_LEN) {
    return json({ error: `challenge too long (max ${MAX_CHALLENGE_LEN} chars)` }, { status: 400 });
  }
  try {
    const { buildId } = await createStudioBuild({
      challenge,
      title: typeof body.title === 'string' ? body.title : undefined,
    });
    return json({ buildId, url: `/jkai/builds/${buildId}` });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
};
```

- [ ] **Step 6: Verify the route rejects a stranger**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:5173/api/jkai/studio \
  -H 'content-type: application/json' -d '{"challenge":"test"}'
```
Expected: `404` when signed out (owner-gated routes 404 rather than 403 here — see other `isOwnerEmail` routes).

- [ ] **Step 7: Commit**

```bash
git add src/lib/jkai/studio.ts src/lib/jkai/studio.test.ts src/routes/api/jkai/studio/+server.ts
git commit -m "feat(studio): build creator and owner-gated create endpoint"
```

---

## Task 9: Wire studio mode into the executor

**Files:**
- Modify: `src/lib/jkai/executor.ts` (~lines 105–200)

**Interfaces:**
- Consumes: `syncExplainerKit` (Task 5), `BuildPromptMode` `'studio'` (Task 6), `build.origin`, `build.chapterPlan` (Task 7)
- Produces: nothing new; behaviour change only

- [ ] **Step 1: Select the mode from origin**

In `executeIteration`, replace the `promptMode` line:

```ts
  const gitTarget = (build as JkaiBuild & { gitTargetConfig?: { gateCommand?: string } | null })
    .gitTargetConfig;
  const isStudio = (build as JkaiBuild & { origin?: string }).origin === 'studio';
  const promptMode: BuildPromptMode = gitTarget ? 'repo' : isStudio ? 'studio' : 'app';
```

- [ ] **Step 2: Swap the design-system suffix for the explainer mount in studio mode**

Replace the `if (enforceDesign) { systemPrompt += '--- Design System (REQUIRED) ---…' }` block with:

```ts
  const enforceDesign = (build as JkaiBuild & { enforceDesignSystem?: boolean }).enforceDesignSystem !== false;
  if (enforceDesign && !isStudio) {
    systemPrompt += `\n\n--- Design System (REQUIRED) ---\nA read-only design-system reference is mounted at \`./design-system/\` (relative to your workdir). BEFORE writing any HTML, CSS, or Svelte:\n1. Read \`./design-system/README.md\`.\n2. Read \`./design-system/components.md\` and \`./design-system/examples/page.svelte\`.\n3. Import \`./design-system/tokens.css\` (or copy its \`:root\` block) at the root of your stylesheet.\n4. Use the documented classes (\`.nm-sec\`, \`.nm-text-input\`, \`.nm-save-btn\`, \`.row-link\`, \`.status-dot\`, \`.kicker\`, \`.page-hdr\`).\n5. Never hard-code hex colours or font names. Always go through \`var(--…)\`.\nA post-iteration linter will reject this iteration on violations and feed the findings into the next iteration.`;
  }
```

The studio prompt already carries its own mount instructions, and the admin-list-page reference is exactly what Studio exists to get away from.

- [ ] **Step 3: Mount the kit**

In the asset-sync block, replace `if (enforceDesign) { … syncDesignAssets … }` with:

```ts
  if (isStudio) {
    try {
      const { syncExplainerKit } = await import('./sandbox');
      const kitPath = await syncExplainerKit(build.id);
      skillDirs.push(kitPath);
    } catch (err) {
      // Loud, not silent. A studio build with no kit will invent its own
      // visual language, fail the visual gate, and burn iterations finding out.
      await emitLog(
        build.id,
        'error',
        `Explainer kit sync FAILED — this build will not have the kit: ${(err as Error).message}`,
        iteration.id,
      );
    }
  } else if (enforceDesign) {
    try {
      const dsPath = await syncDesignAssets(build.id);
      skillDirs.push(dsPath);
    } catch (err) {
      await emitLog(
        build.id,
        'system',
        `Design assets sync failed (continuing without): ${(err as Error).message}`,
        iteration.id,
      );
    }
  }
```

- [ ] **Step 4: Pass the chapter plan into iteration context**

Replace the `buildIterationContext(...)` call:

```ts
  const contextMessages = buildIterationContext(
    build.prompt,
    prevIteration,
    fileList,
    projectPlan,
    iterationNumber,
    assignedPort,
    codebaseDigest,
    promptMode,
    gitTarget?.gateCommand ?? null,
    isStudio
      ? ((build as JkaiBuild & { chapterPlan?: Array<{ n: number; title: string; leverId: string; outcomeId: string }> }).chapterPlan ?? null)
      : null,
  );
```

- [ ] **Step 5: Type-check the touched file**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep 'executor.ts' || echo 'clean'`
Expected: `clean`

- [ ] **Step 6: Run the prompt tests to confirm nothing regressed**

Run: `npx vitest run src/lib/jkai/prompt.test.ts src/lib/jkai/explainer-kit.test.ts src/lib/jkai/design-lint.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/jkai/executor.ts
git commit -m "feat(studio): select studio mode and mount the explainer kit"
```

---

## CHECKPOINT: run one real build before writing the gate

Everything up to here produces working software: a studio build can now be created and will run with the studio prompt and the kit mounted. **Stop and run one.**

- [ ] **Step 1: Create a build against the running dev server**

```bash
curl -s -X POST http://homeserv:5173/api/jkai/studio \
  -H 'content-type: application/json' \
  -b "$OWNER_COOKIE" \
  -d '{"challenge":"Explain how the National Funding Formula decides what a school receives, and why two schools of the same size get different budgets."}'
```

- [ ] **Step 2: Watch it**

Open `/jkai/builds/<id>`. Let it run at least four iterations.

- [ ] **Step 3: Write down what actually went wrong**

Record, in `docs/superpowers/plans/2026-08-10-jkai-studio-observations.md`: which of the four contract points the agent dropped unprompted, whether it used the kit or reinvented, whether chapters came out as real routes, and how many tokens a chapter cost. The two best guardrails in this system — `static-smoke.ts` and the tool-bridge preflight — were both written after watching a specific failure. Tasks 12 and 13 should be adjusted against what you see here.

- [ ] **Step 4: Commit the observations**

```bash
git add docs/superpowers/plans/2026-08-10-jkai-studio-observations.md
git commit -m "docs(studio): first-run observations"
```

---

## Task 10: Research brief

**Files:**
- Create: `src/lib/jkai/research-brief.ts`
- Create: `src/lib/jkai/research-brief.test.ts`

**Interfaces:**
- Consumes: `startResearch(sessionId)` from `$lib/deepdive/worker`; `researchSessions` table; `ResearchReport` from `$lib/deepdive/types` (has `ranked_facts: string[]`, `executive_summary`, `clusters`, `knowledge_gaps?`, `contradictions_map?`); `getLLMClient` from `./llm-client`
- Produces:

```ts
export interface BriefFact { claim: string; sourceUrl: string; detail?: string }
export interface ResearchBrief {
  topic: string;
  facts: BriefFact[];
  concepts: Array<{ name: string; whyHard: string }>;
  causalMap: Array<{ from: string; to: string; relationship: string }>;
  liveData: Array<{ name: string; url: string; what: string }>;
  misconceptions: string[];
  gaps: string[];
  sessionId: string | null;
}
export function isBriefUsable(brief: ResearchBrief): { ok: boolean; reason?: string }
export function formatBriefForPrompt(brief: ResearchBrief): string
export async function buildResearchBrief(buildId: string, challenge: string): Promise<ResearchBrief>
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/jkai/research-brief.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isBriefUsable, formatBriefForPrompt, type ResearchBrief } from './research-brief';

function brief(over: Partial<ResearchBrief> = {}): ResearchBrief {
  return {
    topic: 'school funding',
    facts: Array.from({ length: 9 }, (_, i) => ({
      claim: `fact ${i}`,
      sourceUrl: `https://example.gov.uk/${i}`,
    })),
    concepts: [{ name: 'Basic entitlement', whyHard: 'It is per-pupil but not per-pupil-equal.' }],
    causalMap: [{ from: 'roll', to: 'budget', relationship: 'scales' }],
    liveData: [{ name: 'NFF tables', url: 'https://gov.uk/x', what: 'per-school allocations' }],
    misconceptions: ['People assume funding follows need linearly.'],
    gaps: ['No public figure for in-year adjustments.'],
    sessionId: 'rs_1',
    ...over,
  };
}

describe('isBriefUsable', () => {
  it('accepts a brief with enough sourced facts', () => {
    expect(isBriefUsable(brief()).ok).toBe(true);
  });

  it('refuses a brief with fewer than 8 facts rather than letting the planner invent a syllabus', () => {
    const r = isBriefUsable(brief({ facts: brief().facts.slice(0, 3) }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/3 sourced facts/);
  });

  it('refuses when gaps outnumber facts', () => {
    const r = isBriefUsable(brief({ gaps: Array.from({ length: 12 }, (_, i) => `gap ${i}`) }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/more gaps than facts/);
  });

  it('refuses a fact with no source url — provenance is the whole point', () => {
    const f = brief().facts;
    f[0] = { claim: 'unsourced', sourceUrl: '' };
    const r = isBriefUsable(brief({ facts: f }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/without a source/);
  });

  it('refuses a brief with no causal map — sim.js has nothing to model', () => {
    const r = isBriefUsable(brief({ causalMap: [] }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/causal/);
  });
});

describe('formatBriefForPrompt', () => {
  it('renders every fact with its url so a claim can be traced', () => {
    const out = formatBriefForPrompt(brief());
    expect(out).toContain('https://example.gov.uk/0');
    expect(out).toContain('## FACTS');
    expect(out).toContain('## GAPS');
  });

  it('states plainly that gaps must not be smoothed over', () => {
    expect(formatBriefForPrompt(brief())).toMatch(/do not invent/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/jkai/research-brief.test.ts`
Expected: FAIL — `Failed to resolve import "./research-brief"`

- [ ] **Step 3: Write `src/lib/jkai/research-brief.ts`**

```ts
/**
 * The research stage Studio builds run before planning.
 *
 * Everything downstream cites back to this. The FACTS/GAPS split is deliberate:
 * a flat merged summary destroys provenance, and the fix that worked elsewhere
 * on this site was forcing facts to carry their source and gaps to be named
 * rather than smoothed over.
 *
 * Uses the existing Deep Dive engine — `startResearch` runs asynchronously and
 * writes `report` on the session row — then converts its ResearchReport into
 * the structured brief with one LLM call.
 */
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getLLMClient } from './llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { emitLog } from './log-emitter';
import type { ResearchReport } from '$lib/deepdive/types';

export interface BriefFact {
  claim: string;
  sourceUrl: string;
  detail?: string;
}

export interface ResearchBrief {
  topic: string;
  facts: BriefFact[];
  concepts: Array<{ name: string; whyHard: string }>;
  causalMap: Array<{ from: string; to: string; relationship: string }>;
  liveData: Array<{ name: string; url: string; what: string }>;
  misconceptions: string[];
  gaps: string[];
  sessionId: string | null;
}

const MIN_FACTS = 8;

/**
 * Would a syllabus built on this brief be grounded, or invented?
 *
 * Called before the planner runs. A build that fails here stops with a clear
 * reason instead of producing a confident, sourceless explainer — which is the
 * single worst failure mode available to this feature.
 */
export function isBriefUsable(brief: ResearchBrief): { ok: boolean; reason?: string } {
  if (brief.facts.length < MIN_FACTS) {
    return {
      ok: false,
      reason: `Research produced only ${brief.facts.length} sourced facts (need ${MIN_FACTS}). Narrow the challenge statement or pick a topic with more public material.`,
    };
  }
  const unsourced = brief.facts.filter((f) => !f.sourceUrl || !/^https?:\/\//.test(f.sourceUrl));
  if (unsourced.length > 0) {
    return {
      ok: false,
      reason: `${unsourced.length} fact(s) arrived without a source URL, starting with "${unsourced[0].claim.slice(0, 80)}". A fact without provenance is a guess.`,
    };
  }
  if (brief.gaps.length > brief.facts.length) {
    return {
      ok: false,
      reason: `The brief has more gaps (${brief.gaps.length}) than facts (${brief.facts.length}). There is not enough public material to explain this honestly.`,
    };
  }
  if (brief.causalMap.length === 0) {
    return {
      ok: false,
      reason: 'No causal relationships were found. Without them there is no model to build levers on, and every chapter degrades to prose.',
    };
  }
  return { ok: true };
}

export function formatBriefForPrompt(brief: ResearchBrief): string {
  const lines: string[] = [];
  lines.push(`# Research Brief — ${brief.topic}`);
  lines.push('');
  lines.push('Every factual claim you render must trace to a FACT below. Do not invent figures, and do not smooth over the GAPS — the final chapter should state them honestly.');
  lines.push('');
  lines.push('## FACTS');
  brief.facts.forEach((f, i) => {
    lines.push(`${i + 1}. ${f.claim}${f.detail ? ` — ${f.detail}` : ''}`);
    lines.push(`   source: ${f.sourceUrl}`);
  });
  lines.push('');
  lines.push('## CONCEPTS THAT ARE GENUINELY HARD');
  brief.concepts.forEach((c) => lines.push(`- **${c.name}** — ${c.whyHard}`));
  lines.push('');
  lines.push('## CAUSAL MAP (build your levers and diagrams on this)');
  brief.causalMap.forEach((c) => lines.push(`- ${c.from} → ${c.to}: ${c.relationship}`));
  lines.push('');
  lines.push('## LIVE DATA AVAILABLE');
  brief.liveData.forEach((d) => lines.push(`- ${d.name} (${d.url}) — ${d.what}`));
  lines.push('');
  lines.push('## COMMON MISCONCEPTIONS (chapters should confront these)');
  brief.misconceptions.forEach((m) => lines.push(`- ${m}`));
  lines.push('');
  lines.push('## GAPS');
  brief.gaps.forEach((g) => lines.push(`- ${g}`));
  return lines.join('\n');
}

const CONVERT_PROMPT = `You are converting a research report into a structured brief for someone building an interactive explainer.

Return ONLY a JSON object, no prose and no code fence, with exactly these keys:

{
  "facts": [{ "claim": "...", "sourceUrl": "https://...", "detail": "..." }],
  "concepts": [{ "name": "...", "whyHard": "..." }],
  "causalMap": [{ "from": "...", "to": "...", "relationship": "..." }],
  "liveData": [{ "name": "...", "url": "https://...", "what": "..." }],
  "misconceptions": ["..."],
  "gaps": ["..."]
}

Rules:
- A fact with no source URL in the report must be OMITTED, not invented. Fewer honest facts beats more confident ones.
- causalMap is the model an interactive simulation will be built on. Prefer relationships with a direction and a rough magnitude.
- gaps are what the report could NOT establish. Do not leave this empty to look thorough; an empty gaps list on a complex topic is itself a warning sign.
- Aim for 10-15 facts, 3-5 concepts, 4-8 causal relationships.`;

/**
 * Run the research stage. Polls the Deep Dive session for up to 20 minutes.
 * Throws on timeout or an unusable brief — the caller marks the build failed
 * with the reason, which is far better than an ungrounded explainer.
 */
export async function buildResearchBrief(buildId: string, challenge: string): Promise<ResearchBrief> {
  const { startResearch } = await import('$lib/deepdive/worker');
  const [session] = await db
    .insert(researchSessions)
    .values({
      topic: challenge.slice(0, 500),
      goals: [
        'Identify the mechanisms that drive the outcome, with direction and magnitude',
        'Find public datasets or APIs a reader could explore',
        'Identify what people commonly get wrong about this',
      ],
    })
    .returning();

  await emitLog(buildId, 'system', `Research stage started (session ${session.id}) — this runs before planning.`);
  void startResearch(session.id);

  const deadline = Date.now() + 20 * 60 * 1000;
  let report: ResearchReport | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20_000));
    const [row] = await db.select().from(researchSessions).where(eq(researchSessions.id, session.id));
    if (row?.report) { report = row.report as ResearchReport; break; }
    if (row?.status === 'failed') break;
  }
  if (!report) {
    throw new Error(`Research stage produced no report within 20 minutes (session ${session.id}).`);
  }

  const ctx = await resolveDefaultModel();
  const client = getLLMClient(ctx.modelId);
  const completion = await client.chat.completions.create({
    model: ctx.modelId,
    messages: [
      { role: 'system', content: CONVERT_PROMPT },
      { role: 'user', content: JSON.stringify(report).slice(0, 120_000) },
    ],
  });
  const raw = completion.choices?.[0]?.message?.content ?? '{}';
  const jsonStart = raw.indexOf('{');
  let parsed: Partial<ResearchBrief> = {};
  try {
    parsed = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart, raw.lastIndexOf('}') + 1) : raw);
  } catch {
    throw new Error('Research stage: the brief conversion returned unparseable JSON.');
  }

  const brief: ResearchBrief = {
    topic: challenge.slice(0, 500),
    facts: (parsed.facts ?? []).filter((f) => f && f.claim && f.sourceUrl),
    concepts: parsed.concepts ?? [],
    causalMap: parsed.causalMap ?? [],
    liveData: parsed.liveData ?? [],
    misconceptions: parsed.misconceptions ?? [],
    gaps: parsed.gaps ?? [],
    sessionId: session.id,
  };

  const usable = isBriefUsable(brief);
  if (!usable.ok) throw new Error(`Research stage: ${usable.reason}`);

  await emitLog(
    buildId,
    'system',
    `Research brief ready — ${brief.facts.length} sourced facts, ${brief.causalMap.length} causal links, ${brief.gaps.length} gaps.`,
  );
  return brief;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/jkai/research-brief.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/research-brief.ts src/lib/jkai/research-brief.test.ts
git commit -m "feat(studio): FACTS/GAPS research brief with a usability gate"
```

---

## Task 11: Planner — brief injection, chapter spine, two new critic dimensions

**Files:**
- Modify: `src/lib/jkai/planner.ts`
- Test: `src/lib/jkai/planner-studio.test.ts` (create)

**Interfaces:**
- Consumes: `formatBriefForPrompt`, `ResearchBrief` (Task 10)
- Produces:
  - `STUDIO_PROPOSER_SYSTEM_PROMPT`, `STUDIO_CRITIC_EXTRA` (exported for test)
  - `parseChapterPlan(planMarkdown: string): Array<{ n: number; title: string; leverId: string; outcomeId: string }>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/jkai/planner-studio.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseChapterPlan, STUDIO_CRITIC_EXTRA } from './planner';

describe('parseChapterPlan', () => {
  it('reads the chapter table the studio proposer is told to emit', () => {
    const md = `
## Chapter Plan

| # | Chapter | Lever id | Outcome id |
|---|---------|----------|------------|
| 1 | What a school budget is | roll | total |
| 2 | Where deprivation money goes | fsm | uplift |
`;
    expect(parseChapterPlan(md)).toEqual([
      { n: 1, title: 'What a school budget is', leverId: 'roll', outcomeId: 'total' },
      { n: 2, title: 'Where deprivation money goes', leverId: 'fsm', outcomeId: 'uplift' },
    ]);
  });

  it('returns an empty array when no table is present rather than throwing', () => {
    expect(parseChapterPlan('## Architecture\nsome prose')).toEqual([]);
  });

  it('skips a malformed row instead of dropping the whole plan', () => {
    const md = `
| # | Chapter | Lever id | Outcome id |
|---|---------|----------|------------|
| 1 | Good row | a | b |
| x | Bad row |
| 3 | Also good | c | d |
`;
    expect(parseChapterPlan(md).map((c) => c.n)).toEqual([1, 3]);
  });
});

describe('studio critic', () => {
  it('adds a pedagogy dimension', () => {
    expect(STUDIO_CRITIC_EXTRA).toContain('PEDAGOGY');
    expect(STUDIO_CRITIC_EXTRA).toContain('NO-MODEL:');
    expect(STUDIO_CRITIC_EXTRA).toContain('ARBITRARY-ORDER:');
  });

  it('adds a sourcing dimension', () => {
    expect(STUDIO_CRITIC_EXTRA).toContain('SOURCING');
    expect(STUDIO_CRITIC_EXTRA).toContain('UNSOURCED:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/jkai/planner-studio.test.ts`
Expected: FAIL — `parseChapterPlan is not exported`

- [ ] **Step 3: Add the studio proposer prompt to `planner.ts`**

Insert after `CRITIC_SYSTEM_PROMPT`:

```ts
export const STUDIO_PROPOSER_SYSTEM_PROMPT = `You are designing an interactive explainer — a multi-chapter learning experience about one subject. You produce plans only, no code.

You are given a research brief. Every chapter must be grounded in it.

CONSTRAINTS YOUR PLAN MUST RESPECT:
1. 6-10 chapters. Each is a real route the reader can link to.
2. Every chapter has ONE idea and follows explain → manipulate → consequence: say what the thing is, let the reader change something, show them what that did.
3. Sequence so each chapter can only be understood after the last. A workable spine: what the thing is → what drives it → the mechanism in the middle → what happens when you push it → where it breaks → what is genuinely uncertain. The final chapter names the brief's GAPS honestly.
4. Each chapter names its visual mode from the explainer kit: createScene (spatial/allocation), createDiagram (mechanisms and flow), createSim (levers and consequence), createChart (over time or across categories). Do not use a 3D scene for a time series.
5. Iteration 1 is the skeleton ONLY: serve.json, navigation shell, every chapter reachable with its title and a one-line placeholder. Then one complete chapter per iteration.
6. Real data only, named from the brief's LIVE DATA section.

Format your response as:

## Concept
(what the reader will be able to do at the end that they cannot do now — 2-3 sentences)

## Architecture
(stack, routing, how chapters are served — 3-5 sentences)

## Chapter Plan

| # | Chapter | Lever id | Outcome id |
|---|---------|----------|------------|
| 1 | ... | ... | ... |

(one row per chapter; lever id and outcome id are the data-attribute ids the post-iteration gate will drive — lowercase, no spaces)

## Chapter Detail

### Chapter 1: [title]
- Idea: [the single thing this chapter teaches]
- Visual: [createScene | createDiagram | createSim | createChart, and what it shows]
- Manipulate: [what the reader changes]
- Consequence: [what visibly moves, and why that is the lesson]
- Grounded in: [which numbered FACTS from the brief]

(repeat for every chapter)

## Risks & Mitigations
(2-3 real risks)`;

export const STUDIO_CRITIC_EXTRA = `

8. PEDAGOGY: Does every chapter have explain → manipulate → consequence, or are some just prose with a picture? Is the chapter order a real progression where each depends on the last, or is it topic buckets in arbitrary order? Is any chapter's lever decoration — a control that moves a number the chapter never gave meaning to? Flag chapters with no interactive model as "NO-MODEL:", an order that could be shuffled without loss as "ARBITRARY-ORDER:", and a meaningless control as "DECORATIVE-LEVER:". For each, say concretely what the model should be instead.

9. SOURCING: Does every factual claim in the plan trace to a numbered FACT in the research brief? Look for figures, dates, percentages and mechanisms that appear in the plan but not in the brief. Flag each with "UNSOURCED:" and name the claim. Also check the reverse: is the plan ignoring the brief's GAPS by presenting a settled story where the research found none? Flag that with "FALSE-CONFIDENCE:".`;
```

- [ ] **Step 4: Add `parseChapterPlan`**

Append to `planner.ts`:

```ts
/**
 * Read the chapter table out of the plan markdown.
 *
 * Deliberately forgiving: a malformed row is skipped, not fatal. The plan is
 * LLM output and one bad row must not cost the whole spine — the executor can
 * work from a partial plan, but not from an exception.
 */
export function parseChapterPlan(
  planMarkdown: string,
): Array<{ n: number; title: string; leverId: string; outcomeId: string }> {
  const out: Array<{ n: number; title: string; leverId: string; outcomeId: string }> = [];
  for (const line of planMarkdown.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // ['', '#', 'Chapter', 'Lever id', 'Outcome id', ''] -> 6 cells
    if (cells.length < 6) continue;
    const n = Number.parseInt(cells[1], 10);
    if (!Number.isFinite(n)) continue;
    const [, , title, leverId, outcomeId] = cells;
    if (!title || !leverId || !outcomeId) continue;
    if (/^-+$/.test(title)) continue;
    out.push({ n, title, leverId, outcomeId });
  }
  return out;
}
```

- [ ] **Step 5: Select the studio prompts and persist the chapter plan**

In the planner's main entry function, where `PROPOSER_SYSTEM_PROMPT` and `CRITIC_SYSTEM_PROMPT` are passed to `streamPlannerCall` (lines ~193, ~229, ~274), select by origin. Load the build row and:

```ts
  const isStudio = (build as { origin?: string }).origin === 'studio';
  const proposerPrompt = isStudio ? STUDIO_PROPOSER_SYSTEM_PROMPT : PROPOSER_SYSTEM_PROMPT;
  const criticPrompt = isStudio ? CRITIC_SYSTEM_PROMPT + STUDIO_CRITIC_EXTRA : CRITIC_SYSTEM_PROMPT;
```

Prepend the brief to the proposer's user message when present:

```ts
  const brief = (build as { researchBrief?: ResearchBrief | null }).researchBrief ?? null;
  const briefBlock = brief ? `${formatBriefForPrompt(brief)}\n\n---\n\n` : '';
```

After the final revised plan is produced, persist the spine:

```ts
  if (isStudio) {
    const chapterPlan = parseChapterPlan(finalPlan);
    await db.update(jkaiBuilds).set({ chapterPlan }).where(eq(jkaiBuilds.id, buildId));
    await emitLog(buildId, 'system', `Chapter spine: ${chapterPlan.length} chapters.`);
  }
```

Add the imports at the top of `planner.ts`:

```ts
import { formatBriefForPrompt, type ResearchBrief } from './research-brief';
```

- [ ] **Step 6: Call the research stage before planning**

In `orchestrator.ts`, immediately before the planner is invoked for a build with `origin === 'studio'` and `researchBrief == null`:

```ts
      if ((build as any).origin === 'studio' && !(build as any).researchBrief) {
        try {
          const { buildResearchBrief } = await import('./research-brief');
          const brief = await buildResearchBrief(buildId, build.prompt);
          await db.update(jkaiBuilds).set({ researchBrief: brief }).where(eq(jkaiBuilds.id, buildId));
        } catch (err: any) {
          // Do not fall through to planning. An explainer built without sources
          // is confidently wrong, which is worse than not existing.
          await this.abortBuild(buildId, {
            kind: 'nonzero_exit',
            message: `Research stage failed: ${err.message}`,
            attempts: 1,
          });
          return;
        }
      }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/lib/jkai/planner-studio.test.ts src/lib/jkai/research-brief.test.ts`
Expected: PASS

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'planner.ts|orchestrator.ts' || echo clean`
Expected: `clean`

- [ ] **Step 8: Commit**

```bash
git add src/lib/jkai/planner.ts src/lib/jkai/planner-studio.test.ts src/lib/jkai/orchestrator.ts
git commit -m "feat(studio): brief-grounded chapter planning with pedagogy and sourcing critics"
```

---

## Task 12: The gate runner

A separate script from `smoke-static-app.mjs` because that one opens a local `index.html` in a directory, and Studio needs to drive a *served* multi-route app.

**Files:**
- Create: `scripts/studio-gate.mjs`
- Modify: `scripts/ci-deploy.sh`

**Interfaces:**
- Consumes: argv — `node scripts/studio-gate.mjs <baseUrl>` with the spec piped in as base64 on stdin
- Produces: exactly one JSON object on stdout:
  `{ ran: true, passed: boolean, findings: Array<{ chapter: number, rule: string, message: string, remedy: string }> }`
  or `{ ran: false, reason: string }`

- [ ] **Step 1: Read the precedent**

Run: `cat scripts/smoke-static-app.mjs`
Copy its stdin/base64 convention, its single-JSON-line output, and its "never throw, always print" discipline.

- [ ] **Step 2: Write `scripts/studio-gate.mjs`**

```js
#!/usr/bin/env node
/**
 * Studio gate — does the explainer actually teach?
 *
 * Four checks per chapter: reachable, has a kit-produced visual, has a control
 * that changes an outcome when driven, cites a source from the brief.
 *
 * Contract, copied from smoke-static-app.mjs: a harness that could not run
 * prints { ran: false }. Never { passed: false }. A broken harness reporting a
 * failing app blocks good work and teaches the model to route around the tool.
 *
 * Every finding carries a `remedy`. An unfixable finding repeated three times
 * kills a finished build — that is the design_lint_loop incident of 2026-08-09.
 */
let out = { ran: false, reason: 'harness did not start' };

async function main() {
  const baseUrl = process.argv[2];
  if (!baseUrl) { out = { ran: false, reason: 'no base url given' }; return; }

  const stdin = await new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (buf += d));
    process.stdin.on('end', () => resolve(buf));
    setTimeout(() => resolve(buf), 5000);
  });

  let spec;
  try {
    spec = JSON.parse(Buffer.from(stdin.trim(), 'base64').toString('utf8'));
  } catch {
    out = { ran: false, reason: 'could not parse the spec on stdin' };
    return;
  }
  const chapters = spec.chapters || [];
  const sourceHosts = new Set(
    (spec.sourceUrls || []).map((u) => { try { return new URL(u).host; } catch { return null; } }).filter(Boolean),
  );
  if (chapters.length === 0) { out = { ran: false, reason: 'no chapters in the spec' }; return; }

  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch (e) { out = { ran: false, reason: `playwright is not available: ${e.message}` }; return; }

  let browser;
  try { browser = await chromium.launch({ args: ['--no-sandbox'] }); }
  catch (e) { out = { ran: false, reason: `could not launch chromium: ${e.message}` }; return; }

  const findings = [];
  try {
    for (const ch of chapters) {
      const url = new URL(ch.path, baseUrl).toString();
      const page = await browser.newPage();
      try {
        const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
        if (!resp || resp.status() >= 400) {
          findings.push({
            chapter: ch.n, rule: 'unreachable',
            message: `Chapter ${ch.n} (${ch.title}) returned ${resp ? resp.status() : 'no response'} at ${ch.path}.`,
            remedy: `Add a route serving ${ch.path} that returns 200 with a root element carrying data-chapter="${ch.n}".`,
          });
          continue;
        }

        const marked = await page.locator(`[data-chapter="${ch.n}"]`).count();
        if (marked === 0) {
          findings.push({
            chapter: ch.n, rule: 'unmarked',
            message: `Chapter ${ch.n} has no element with data-chapter="${ch.n}".`,
            remedy: `Put data-chapter="${ch.n}" on the chapter's root element in the file serving ${ch.path}.`,
          });
        }

        const visuals = await page.locator('canvas[data-scene], svg').count();
        if (visuals === 0) {
          findings.push({
            chapter: ch.n, rule: 'prose-only',
            message: `Chapter ${ch.n} (${ch.title}) renders no canvas or svg — it is prose.`,
            remedy: `Add a kit visual to ${ch.path}: Explainer.createDiagram for a mechanism, createScene for something spatial, createChart for a series. See ./explainer-kit/scenes.md.`,
          });
        }

        const lever = page.locator(`[data-lever="${ch.leverId}"]`).first();
        const outcome = page.locator(`[data-outcome="${ch.outcomeId}"]`).first();
        const haveLever = (await lever.count()) > 0;
        const haveOutcome = (await outcome.count()) > 0;
        if (!haveLever || !haveOutcome) {
          findings.push({
            chapter: ch.n, rule: 'no-model',
            message: `Chapter ${ch.n} is missing ${!haveLever ? `a control tagged data-lever="${ch.leverId}"` : ''}${!haveLever && !haveOutcome ? ' and ' : ''}${!haveOutcome ? `an element tagged data-outcome="${ch.outcomeId}"` : ''}.`,
            remedy: `Use Explainer.createSim in ${ch.path} with a lever id of "${ch.leverId}" and an outcome id of "${ch.outcomeId}". It tags both for you.`,
          });
        } else {
          const before = (await outcome.textContent()) ?? '';
          const min = Number(await lever.getAttribute('min'));
          const max = Number(await lever.getAttribute('max'));
          const target = Number.isFinite(min) && Number.isFinite(max) ? String(min + (max - min) * 0.8) : '1';
          await lever.fill(target).catch(async () => { await lever.click().catch(() => {}); });
          await lever.dispatchEvent('input').catch(() => {});
          await page.waitForTimeout(400);
          const after = (await outcome.textContent()) ?? '';
          if (before.trim() === after.trim()) {
            findings.push({
              chapter: ch.n, rule: 'inert-lever',
              message: `Chapter ${ch.n}: moving data-lever="${ch.leverId}" left data-outcome="${ch.outcomeId}" unchanged at "${before.trim().slice(0, 40)}".`,
              remedy: `The step() function in ${ch.path} must return a value for "${ch.outcomeId}" that depends on "${ch.leverId}". A control that changes nothing is decoration.`,
            });
          }
        }

        const citations = await page.locator('a[data-citation]').evaluateAll((els) =>
          els.map((e) => e.getAttribute('href') || ''),
        );
        const good = citations.filter((href) => {
          try { return sourceHosts.has(new URL(href).host); } catch { return false; }
        });
        if (good.length === 0) {
          findings.push({
            chapter: ch.n, rule: 'uncited',
            message: `Chapter ${ch.n} has ${citations.length} citation link(s), none pointing at a source from the research brief.`,
            remedy: `Add <a data-citation href="..."> in ${ch.path} linking to one of the FACT source URLs in the brief.`,
          });
        }
      } catch (e) {
        findings.push({
          chapter: ch.n, rule: 'errored',
          message: `Chapter ${ch.n} threw while being checked: ${e.message}`,
          remedy: `Open ${ch.path} in a browser and fix the runtime error before adding more chapters.`,
        });
      } finally {
        await page.close().catch(() => {});
      }
    }
    out = { ran: true, passed: findings.length === 0, findings };
  } catch (e) {
    out = { ran: false, reason: `the gate harness failed: ${e.message}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

main()
  .catch((e) => { out = { ran: false, reason: `unexpected: ${e.message}` }; })
  .finally(() => { process.stdout.write(JSON.stringify(out) + '\n'); });
```

- [ ] **Step 3: Smoke the runner against a hand-made page**

```bash
mkdir -p /tmp/claude-1000/-home-john/*/scratchpad/studiotest && cd $_
cat > index.html <<'HTML'
<div data-chapter="1"><svg width="10" height="10"></svg>
<input type="range" min="0" max="10" value="1" data-lever="a"
  oninput="document.querySelector('[data-outcome=b]').textContent=this.value">
<strong data-outcome="b">1</strong>
<a data-citation href="https://example.gov.uk/x">src</a></div>
HTML
python3 -m http.server 8899 &
echo '{"chapters":[{"n":1,"title":"t","path":"/","leverId":"a","outcomeId":"b"}],"sourceUrls":["https://example.gov.uk/y"]}' \
  | base64 -w0 | node ~/strange_rambling_svelte/scripts/studio-gate.mjs http://127.0.0.1:8899
kill %1
```
Expected: `{"ran":true,"passed":true,"findings":[]}`

- [ ] **Step 4: Smoke the negative case**

Rerun Step 3 with the `oninput` attribute deleted.
Expected: `ran: true, passed: false`, one finding with `"rule":"inert-lever"` and a non-empty `remedy`.

- [ ] **Step 5: Add the ci-deploy allow-list line**

In `scripts/ci-deploy.sh`, directly after the `smoke-static-app.mjs` line (~line 61):

```bash
rsync -a scripts/studio-gate.mjs "$VPS_DIR/scripts/"
```

**Do not skip this.** `ci-deploy.sh` syncs an explicit allow-list. Without the line the gate is absent in production, `runStudioGate` reports `ran: false`, and the build sails through with no checks — a fail-soft feature that cannot report being undeployed.

- [ ] **Step 6: Verify the line landed**

```bash
grep -n 'studio-gate.mjs' scripts/ci-deploy.sh
```
Expected: one match.

- [ ] **Step 7: Commit**

```bash
git add scripts/studio-gate.mjs scripts/ci-deploy.sh
git commit -m "feat(studio): playwright gate runner and its ci-deploy allow-list line"
```

---

## Task 13: studio-gate module and orchestrator wiring

**Files:**
- Create: `src/lib/jkai/studio-gate.ts`
- Create: `src/lib/jkai/studio-gate.test.ts`
- Modify: `src/lib/jkai/orchestrator.ts` (after the `manageServeConfig(buildId)` call at ~line 1169)

**Interfaces:**
- Consumes: `execInSandbox` from `./sandbox`; `readServeJson`; `ResearchBrief`
- Produces:

```ts
export interface GateFinding { chapter: number; rule: string; message: string; remedy: string }
export type GateOutcome =
  | { ran: true; passed: boolean; findings: GateFinding[] }
  | { ran: false; reason: string };
export function parseGateOutput(stdout: string, stderr: string): GateOutcome
export function describeGate(outcome: GateOutcome): string
export async function runStudioGate(opts: {
  baseUrl: string;
  chapters: Array<{ n: number; title: string; path: string; leverId: string; outcomeId: string }>;
  sourceUrls: string[];
}): Promise<GateOutcome>
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/jkai/studio-gate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseGateOutput, describeGate } from './studio-gate';

describe('parseGateOutput', () => {
  it('reads a clean pass', () => {
    const r = parseGateOutput('{"ran":true,"passed":true,"findings":[]}', '');
    expect(r).toEqual({ ran: true, passed: true, findings: [] });
  });

  it('reads findings', () => {
    const r = parseGateOutput(
      '{"ran":true,"passed":false,"findings":[{"chapter":2,"rule":"prose-only","message":"m","remedy":"r"}]}',
      '',
    );
    expect(r.ran).toBe(true);
    if (r.ran) {
      expect(r.passed).toBe(false);
      expect(r.findings[0].remedy).toBe('r');
    }
  });

  it('tolerates npm noise before the JSON', () => {
    const r = parseGateOutput('npm warn whatever\n{"ran":true,"passed":true,"findings":[]}', '');
    expect(r.ran).toBe(true);
  });

  // The contract inherited from static-smoke.ts. A harness that could not run
  // must never be reported as a failing app.
  it('turns unparseable output into ran:false, never passed:false', () => {
    expect(parseGateOutput('total garbage', '')).toEqual({
      ran: false,
      reason: 'total garbage',
    });
  });

  it('turns empty output into ran:false with the stderr as the reason', () => {
    const r = parseGateOutput('', 'Error: chromium missing');
    expect(r).toEqual({ ran: false, reason: 'Error: chromium missing' });
  });
});

describe('describeGate', () => {
  it('says skipped, not failed, when the harness did not run', () => {
    const s = describeGate({ ran: false, reason: 'no chromium' });
    expect(s).toMatch(/skipped/i);
    expect(s).not.toMatch(/failed/i);
  });

  it('includes the remedy so the next iteration knows what to do', () => {
    const s = describeGate({
      ran: true, passed: false,
      findings: [{ chapter: 2, rule: 'prose-only', message: 'Chapter 2 renders no canvas or svg.', remedy: 'Add a kit visual.' }],
    });
    expect(s).toContain('Chapter 2 renders no canvas or svg.');
    expect(s).toContain('Add a kit visual.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/jkai/studio-gate.test.ts`
Expected: FAIL — `Failed to resolve import "./studio-gate"`

- [ ] **Step 3: Write `src/lib/jkai/studio-gate.ts`**

```ts
/**
 * Does the explainer actually teach?
 *
 * Four checks per chapter, driven in a real browser: reachable, has a visual,
 * has a control that moves an outcome, cites the brief. The runner is
 * scripts/studio-gate.mjs — a subprocess for the same reason
 * scripts/smoke-static-app.mjs is one: `import('playwright')` resolves from the
 * script's own directory, so the file must live in the repo.
 *
 * Contract: a harness that could not run reports `ran: false`, never
 * `passed: false`.
 */
import { execInSandbox } from './sandbox';

export interface GateFinding {
  chapter: number;
  rule: string;
  message: string;
  /** What to change, named concretely. A finding with no remedy is a trap. */
  remedy: string;
}

export type GateOutcome =
  | { ran: true; passed: boolean; findings: GateFinding[] }
  | { ran: false; reason: string };

export function parseGateOutput(stdout: string, stderr: string): GateOutcome {
  const line = (stdout ?? '').trim();
  if (!line) {
    return { ran: false, reason: stderr?.trim().slice(0, 300) || 'the studio gate printed nothing' };
  }
  const start = line.indexOf('{');
  if (start === -1) return { ran: false, reason: line.slice(0, 300) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(start));
  } catch {
    return { ran: false, reason: line.slice(0, 300) };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ran: false, reason: 'studio gate output was not an object' };
  }
  const r = parsed as Record<string, unknown>;
  if (r.ran !== true) {
    return { ran: false, reason: typeof r.reason === 'string' ? r.reason : 'the studio gate did not run' };
  }
  const findings = Array.isArray(r.findings) ? (r.findings as GateFinding[]) : [];
  return { ran: true, passed: r.passed === true, findings };
}

export function describeGate(outcome: GateOutcome): string {
  if (!outcome.ran) return `Studio gate skipped — ${outcome.reason}`;
  if (outcome.passed) return 'Studio gate passed — every chapter is reachable, visual, interactive and cited.';
  const lines = outcome.findings.map(
    (f) => `  ✗ [${f.rule}] ${f.message}\n     → ${f.remedy}`,
  );
  return `Studio gate FAILED — ${outcome.findings.length} finding(s):\n${lines.join('\n')}`;
}

export async function runStudioGate(opts: {
  baseUrl: string;
  chapters: Array<{ n: number; title: string; path: string; leverId: string; outcomeId: string }>;
  sourceUrls: string[];
}): Promise<GateOutcome> {
  if (opts.chapters.length === 0) {
    return { ran: false, reason: 'no chapter plan on the build — nothing to check' };
  }
  const payload = JSON.stringify({ chapters: opts.chapters, sourceUrls: opts.sourceUrls });
  const encoded = Buffer.from(payload, 'utf-8').toString('base64');
  const cmd =
    `cd ${JSON.stringify(process.cwd())} && ` +
    `echo ${encoded} | base64 -d | node scripts/studio-gate.mjs ${JSON.stringify(opts.baseUrl)}`;
  try {
    const res = await execInSandbox(cmd, 180_000);
    return parseGateOutput(res.stdout, res.stderr);
  } catch (err) {
    return {
      ran: false,
      reason: `could not run the studio gate: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/jkai/studio-gate.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Wire it into the orchestrator**

In `src/lib/jkai/orchestrator.ts`, immediately after the `await manageServeConfig(buildId);` inside the `if (!build.gitTargetConfig)` block (~line 1169):

```ts
        // Studio gate. Runs after promotion so it drives the same build the
        // user is looking at. Findings feed the next iteration; they never
        // abort on their own — the budget cap terminates a build that cannot
        // converge, and the idle-iteration breaker catches an agent that has
        // stopped changing files.
        if ((build as any).origin === 'studio' && iterationNumber > 1) {
          const chapterPlan = ((build as any).chapterPlan ?? []) as Array<{
            n: number; title: string; leverId: string; outcomeId: string;
          }>;
          const brief = (build as any).researchBrief as { facts?: Array<{ sourceUrl: string }> } | null;
          const serve = (build as any).serveConfig as { port?: number } | null;
          if (chapterPlan.length > 0 && serve?.port) {
            const { runStudioGate, describeGate } = await import('./studio-gate');
            const outcome = await runStudioGate({
              baseUrl: `http://127.0.0.1:${serve.port}`,
              chapters: chapterPlan.map((c) => ({ ...c, path: `/chapter-${c.n}/` })),
              sourceUrls: (brief?.facts ?? []).map((f) => f.sourceUrl),
            });
            const summary = describeGate(outcome);
            await emitLog(
              buildId,
              outcome.ran && !outcome.passed ? 'error' : 'system',
              summary,
              iteration.id,
            );
            if (outcome.ran && !outcome.passed && result.evaluation) {
              result.evaluation = `${result.evaluation}\n\n## Studio gate\n${summary}`;
              await db
                .update(jkaiIterations)
                .set({ evaluation: result.evaluation })
                .where(eq(jkaiIterations.id, iteration.id));
            }
          }
        }
```

Note the `iterationNumber > 1` guard: iteration 1 is the skeleton, where placeholder chapters are correct and failing them would be a finding the agent is forbidden to fix.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep 'orchestrator.ts' || echo clean`
Expected: `clean`

- [ ] **Step 7: Commit**

```bash
git add src/lib/jkai/studio-gate.ts src/lib/jkai/studio-gate.test.ts src/lib/jkai/orchestrator.ts
git commit -m "feat(studio): run the teaching gate after each chapter iteration"
```

---

## Task 14: Chat tool and builds UI entry points

**Files:**
- Create: `src/lib/workflows/site-tools/tools/studio.ts`
- Modify: `src/routes/jkai/builds/new/+page.svelte`

**Interfaces:**
- Consumes: `createStudioBuild` (Task 8), the `register` helper used by every file in `site-tools/tools/`
- Produces: tool `studio_build` in toolset `builds`

- [ ] **Step 1: Read two precedents**

Run: `sed -n '1,60p' src/lib/workflows/site-tools/tools/builds.ts` and `sed -n '1,40p' src/lib/workflows/site-tools/tools/request-change.ts`
Copy their `register({...})` shape, their `toolset`, and their return convention exactly.

- [ ] **Step 2: Write the tool**

Create `src/lib/workflows/site-tools/tools/studio.ts`:

```ts
import { register } from '../registry-internal';

register({
  name: 'studio_build',
  description:
    'Start a Studio build: turn a challenge statement into a multi-chapter interactive explainer ' +
    'published at /projects/<slug>/. Runs a research stage, plans a chapter spine, then builds one ' +
    'complete chapter per iteration. Use this when the user wants to LEARN a topic, not when they ' +
    'want an app or a change to an existing repo.',
  parameters: {
    type: 'object',
    properties: {
      challenge: {
        type: 'string',
        description:
          'What the reader should understand by the end. A good challenge names a subject and the ' +
          'thing about it that is counter-intuitive, e.g. "Explain how the National Funding Formula ' +
          'decides what a school receives, and why two schools of the same size get different budgets."',
      },
      title: { type: 'string', description: 'Optional title override' },
    },
    required: ['challenge'],
  },
  category: 'jkai Builds',
  toolset: 'builds',
  handler: async (args) => {
    const { createStudioBuild } = await import('$lib/jkai/studio');
    const { buildId } = await createStudioBuild({
      challenge: args.challenge as string,
      title: args.title as string | undefined,
    });
    return { success: true, data: { buildId, url: `/jkai/builds/${buildId}` } };
  },
});
```

- [ ] **Step 3: Confirm it registers**

Check how `src/lib/workflows/site-tools/registry.ts` discovers tool files — if it imports each explicitly, add `import './tools/studio';` next to the other imports.

Run:
```bash
npx vitest run src/lib/workflows/site-tools/ 2>&1 | tail -20
```
Expected: existing tool tests still pass.

Then confirm the tool is exposed and is not treated as destructive (destructive tools are never bridged to builds):
```bash
node --input-type=module -e "
const m = await import('./src/lib/workflows/site-tools/registry.ts');
const t = m.getTool('studio_build');
console.log(t ? 'registered, destructive=' + !!t.destructive : 'NOT REGISTERED');
" 2>/dev/null || echo 'run this check via a vitest scratch test instead'
```
Expected: `registered, destructive=false`

- [ ] **Step 4: Add the UI option**

In `src/routes/jkai/builds/new/+page.svelte`, add a Studio mode toggle beside the existing controls. Read the file's existing `$state` declarations first and match them.

```svelte
<script lang="ts">
  // ...existing state...
  let studioMode = $state(false);
</script>

<label class="nm-check">
  <input type="checkbox" bind:checked={studioMode} />
  <span>Studio — multi-chapter interactive explainer</span>
</label>
{#if studioMode}
  <p class="hint">
    Runs a research stage first, plans a 6–10 chapter spine, then builds one complete chapter
    per iteration. Budget and design settings above are replaced by the Studio defaults.
  </p>
{/if}
```

And in the submit handler, branch before the existing `POST /api/jkai/builds`:

```ts
  if (studioMode) {
    const res = await fetch('/api/jkai/studio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge: prompt, title: title || undefined }),
    });
    const data = await res.json();
    if (data.buildId) { goto(`/jkai/builds/${data.buildId}`); return; }
    error = data.error ?? 'Studio build failed to start';
    return;
  }
```

- [ ] **Step 5: Verify the page still builds**

Run: `npx svelte-check --threshold error --output human 2>&1 | grep -A3 'builds/new' || echo clean`
Expected: `clean`

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/site-tools/tools/studio.ts src/lib/workflows/site-tools/registry.ts src/routes/jkai/builds/new/+page.svelte
git commit -m "feat(studio): studio_build chat tool and builds UI entry point"
```

---

## Task 15: Full verification and ship

**Files:** none — this is the gate.

- [ ] **Step 1: Full unit suite for everything touched**

```bash
npx vitest run \
  src/lib/jkai/explainer-kit.test.ts \
  src/lib/jkai/design-lint.test.ts \
  src/lib/jkai/prompt.test.ts \
  src/lib/jkai/studio.test.ts \
  src/lib/jkai/research-brief.test.ts \
  src/lib/jkai/planner-studio.test.ts \
  src/lib/jkai/studio-gate.test.ts
```
Expected: all pass. Record the counts.

- [ ] **Step 2: Run the repo gate**

Run: `npm run gate`
Expected: exit 0. Do not `source .env` first — that breaks the gate.

- [ ] **Step 3: The negative test that actually matters**

Start a Studio build whose challenge is deliberately thin on visual material. Confirm that when the agent ships a prose-only chapter, studio-gate produces a `prose-only` finding naming that chapter and its remedy, and that **the following iteration fixes it**. If it cannot recover in one iteration, the remedy text is not concrete enough — rewrite it and re-run. A gate that cannot be satisfied is `design_lint_loop` rebuilt.

- [ ] **Step 4: Merge and let CI deploy**

```bash
git push -u origin HEAD
gh pr create --title "jkai Studio — autonomous interactive explainers" --body "Implements docs/superpowers/specs/2026-08-10-jkai-studio-explainer-builds-design.md"
BRANCH=$(git branch --show-current)
until [ "$(gh run list --branch "$BRANCH" --limit 1 --json conclusion --jq '.[0].conclusion')" != "" ]; do sleep 45; done
gh run list --branch "$BRANCH" --limit 1 --json conclusion --jq '.[0].conclusion'   # must be "success"
gh pr merge <N> --squash
```

Never `gh pr merge --auto` — SR-Main is private on GitHub Free, required status checks do not exist, and `--auto` merges immediately, cancelling the in-flight run.

- [ ] **Step 5: Confirm the deploy actually landed**

```bash
gh run list --branch master --limit 3 --json conclusion,displayTitle
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 'cat /opt/strange-rambling-svelte/build/.deploy-sha'
```
Expected: the sha matches the squashed commit. A merged PR is not a deployed PR — a newer run evicts an older pending one, and 0 runs means a dropped webhook.

- [ ] **Step 6: Confirm the gate runner reached production**

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 'ls -la /opt/strange-rambling-svelte/scripts/studio-gate.mjs'
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 'ls /opt/strange-rambling-svelte/build/client/explainer-kit/'
```
Expected: the script exists, and the kit lists all nine files. If the script is missing, the ci-deploy line from Task 12 Step 5 did not land.

- [ ] **Step 7: One real end-to-end build on production**

Start a Studio build from chat. When it completes and is published:

```bash
curl -s https://strangeramblings.com/projects/<slug>/ | grep -c 'data-chapter'
curl -s -o /dev/null -w '%{http_code}\n' https://strangeramblings.com/projects/<slug>/chapter-3/
```
Expected: at least one `data-chapter` on the index, `200` on chapter 3. Then open chapter 3 and confirm the scene renders and a lever moves an outcome.

- [ ] **Step 8: Update memory**

Write `~/.claude/projects/-home-john/memory/project_jkai_studio.md` covering: what Studio is, that the kit lives in `static/explainer-kit/` and rides `build/` (no allow-list line), that `scripts/studio-gate.mjs` DOES need its allow-list line, and the four-part chapter contract. Add the pointer line to `MEMORY.md`.

---

## Self-Review

**Spec coverage**

| Spec component | Task |
|---|---|
| 1 — Explainer kit | 1, 2, 3, 4 |
| 2 — Explainer design mount replaces admin mount | 5, and executor selection in 9 |
| 3 — Research stage | 10, invoked in 11 Step 6 |
| 4 — Planner changes | 11 |
| 5 — studio-gate | 12, 13 |
| 6 — Budget and model routing | 8 (`STUDIO_BUDGET`) |
| 7 — Autonomy entry points | 8 (API), 14 (chat tool, UI) |
| Verification section | 15 |

**Known deviation from the spec:** the spec says "No `ci-deploy.sh` change, by design." That holds for the explainer kit but is wrong overall — `scripts/studio-gate.mjs` needs its own rsync line, because `ci-deploy.sh` syncs an explicit allow-list and `smoke-static-app.mjs` has its own line for exactly this reason. Task 12 Step 5 covers it; the spec's Component 1 note should be amended to say "no allow-list change *for the kit*".

**Deferred from the spec, deliberately:** the model split (Codex for research/planning, OpenRouter for iterations) is not implemented. `createStudioBuild` uses `resolveDefaultModel()` like `forge.ts` does. Splitting the provider per stage has no precedent in the codebase and would be the only place model selection varies within a build — worth doing only once the first three builds show the latency actually hurts. Logged in the Decision Log.

**Type consistency:** `chapterPlan` entries are `{ n, title, leverId, outcomeId }` in schema (Task 7), prompt context (Task 6), planner output (Task 11) and gate input (Task 13) — the gate adds `path` at the call site rather than storing it, since the route convention `/chapter-<n>/` is fixed by the prompt. `GateFinding` carries `remedy` in the runner (Task 12), the module (Task 13) and the tests. `ResearchBrief` is defined once in Task 10 and imported as a type by Task 7 and Task 11.

## Decision Log

| Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|
| Kit location | `packages/` / `src/lib/` / `static/` | `static/explainer-kit/` | `ci-deploy.sh` never syncs `packages/`; a `src/lib/` asset read at runtime needs an allow-list line and fails soft without it. `static/` rides `build/`. Same pattern `syncJkaiExtension` already uses. | Yes — move + one rsync line |
| three.js delivery | CDN tag / npm / vendored | Vendored, pinned 0.169.0 | A published bundle must not depend on a third party staying up; pinned is reproducible. | Yes |
| Design enforcement for studio | Off / on with new mount | On, new mount | The linter was never wrong — the admin-list-page reference was. Turning it off would also lose `no-raw-hex`. | Yes — one boolean |
| Gate runner | Extend `smoke-static-app.mjs` / new script | New `studio-gate.mjs` | The existing one opens a local `index.html`; Studio needs a served multi-route app. Extending it risks regressing the path that catches "calculator returns 0 for every sum". | Yes |
| Gate on failure | Abort / feed back | Feed findings into the next iteration | `design_lint_loop` is the standing lesson. The budget cap and idle-iteration breaker already terminate a non-converging build. | Yes |
| Gate on iteration 1 | Run / skip | Skip | Iteration 1 is the skeleton; placeholder chapters are correct there, and failing them would be an unfixable finding. | Yes |
| Model routing | Codex everywhere / split / default | Default (`resolveDefaultModel`) for now | The split has no precedent in the codebase and would be the only intra-build model variation. Measure first. Deviates from the spec — logged here rather than silently. | Yes |
| Chapter route convention | Agent-chosen / fixed | Fixed `/chapter-<n>/` | The gate must construct URLs without asking. A free convention means storing a path per chapter and one more thing for the agent to get wrong. | Yes |
| Research failure | Warn and continue / abort | Abort the build | An explainer built without sources is confidently wrong, which is worse than one that does not exist. | Yes |
| Brief minimum | 5 / 8 / 12 facts | 8 | Below ~8 there is not enough to ground 6–10 chapters, and the planner starts inventing. Round number, tune on real briefs. | Yes — one const |
