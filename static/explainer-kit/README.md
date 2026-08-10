# Explainer kit

Read-only. Mounted at `./explainer-kit/` in your workspace. Copy the files you
need into your project and reference them with `<script src="...">`; do not
edit the mount — it is regenerated every iteration and any change you make to
it is discarded.

Pinned dependency: `three@0.160.0` (`three.min.js`, vendored — do NOT add a CDN
`<script>` tag for three.js, and do NOT `npm install three`). This is the last
three.js release to ship a UMD build (`build/three.min.js`); every later
version dropped it in favour of ES modules only, so nothing newer can be
loaded from a plain `<script>` tag with no bundler and no import map.

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
