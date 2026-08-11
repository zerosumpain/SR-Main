/**
 * instruments.js — the SVG artefact library.
 *
 * Ported from the Engine Room's viz/ set, which is the house style these
 * explainers are aiming at: inline SVG, no dependencies, every colour from a
 * --ex-* token, and every visual sitting in the same frame so a reader can
 * land on any chapter and know where to look.
 *
 * WHY SVG AND NOT 3D. Both target pages — policy-engine and the Engine Room —
 * contain zero canvas and zero WebGL. policy-engine is forty inline SVGs. The
 * low-poly scene in lowpoly.js is a real capability and the right answer for a
 * quantity that varies across a SET, but it is the exception; a diagram or an
 * instrument is the default. Do not reach for a 3D scene to draw nine boxes.
 *
 * THE FRAME. createInstrument is the consistency device. Order inside it is
 * deliberate and fixed: label, title, one line naming what is plotted,
 * controls, the visual, then at most one sentence of payoff UNDER the visual.
 * The caption goes under because a caption above gets read instead of the
 * control getting touched.
 *
 * Every factory takes `{ mount, … }` and returns the element it created, so
 * they compose:
 *
 *   const inst = Explainer.createInstrument({
 *     mount: document.querySelector('#budget'),
 *     kicker: 'per pupil',
 *     title: 'Where the money lands',
 *     reading: 'Each bar is one funding stream, in pounds per pupil.',
 *     takeaway: 'Two streams carry <b>four fifths</b> of the total.',
 *   });
 *   Explainer.createBars({ mount: inst.body, items: [...] });
 *
 * Interactive controls belong in inst.controls, and outcomes should carry
 * data-outcome so the checker can see the lever move something.
 */
(function () {
  const ns = (window.Explainer = window.Explainer || {});
  const SVGNS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs || {}) n.setAttribute(k, String(attrs[k]));
    return n;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function resolveMount(mount, who) {
    const node = typeof mount === 'string' ? document.querySelector(mount) : mount;
    if (!node) throw new Error(`${who}: spec.mount did not resolve to an element`);
    return node;
  }

  /** Categorical token by index, wrapping at six. */
  function cat(i) {
    return `var(--ex-cat-${(i % 6) + 1})`;
  }

  /** Sequential ramp token for t in 0..1. */
  function ramp(t) {
    const step = Math.max(0, Math.min(4, Math.round((Number(t) || 0) * 4)));
    return `var(--ex-ramp-${step})`;
  }

  /**
   * Numbers that reach a visual must be finite. A NaN silently produces an
   * element positioned at NaN, which renders nothing, throws no error, and
   * passes a check that only counts elements — exactly how a blank canvas
   * shipped and scored as a working scene.
   */
  function num(v, fallback, where) {
    // Absent is not wrong — most of these are optional and the fallback IS the
    // documented default. Only a value that was supplied and is unusable earns
    // a complaint, or the console fills with noise and the real NaN hides in it.
    if (v == null || v === '') return fallback;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    console.error(`[explainer-kit] ${where}: expected a number, got ${JSON.stringify(v)}`);
    return fallback;
  }

  function textEl(x, y, str, opts) {
    const o = opts || {};
    const t = svgEl('text', {
      x,
      y,
      fill: o.fill || 'var(--ex-ink)',
      'font-size': o.size || 12,
      'font-family': o.mono ? 'var(--font-mono)' : 'var(--font-body)',
      'text-anchor': o.anchor || 'start',
      'dominant-baseline': o.baseline || 'auto',
      'font-weight': o.weight || 400,
    });
    t.textContent = str == null ? '' : String(str);
    return t;
  }

  function frameSvg(w, h, label) {
    return svgEl('svg', {
      viewBox: `0 0 ${w} ${h}`,
      width: '100%',
      role: 'img',
      'aria-label': label || 'Figure',
    });
  }

  // ---------------------------------------------------------------- frame

  /**
   * The frame every visual sits in.
   * Returns { root, body, controls } — mount your visual into `.body` and any
   * <input>/<select> into `.controls`.
   */
  ns.createInstrument = function createInstrument(spec) {
    const mount = resolveMount(spec && spec.mount, 'createInstrument');
    const root = el('figure', 'ex-inst');

    const head = el('div', 'ex-inst-head');
    const id = el('div', 'ex-inst-id');
    if (spec.kicker) id.appendChild(el('span', 'ex-inst-kick', spec.kicker));
    id.appendChild(el('h3', 'ex-inst-title', spec.title || ''));
    head.appendChild(id);
    const controls = el('div', 'ex-inst-ctl');
    head.appendChild(controls);
    root.appendChild(head);

    if (spec.reading) root.appendChild(el('p', 'ex-inst-read', spec.reading));

    const body = el('div', 'ex-inst-body');
    root.appendChild(body);

    if (spec.takeaway) {
      const cap = el('figcaption', 'ex-inst-take');
      const mark = el('span', 'ex-inst-mark', '▸');
      mark.setAttribute('aria-hidden', 'true');
      cap.appendChild(mark);
      const words = el('span');
      // Deliberately innerHTML: takeaways use <b> to mark the number that
      // matters, and the caller is the build's own template, not a reader.
      words.innerHTML = spec.takeaway;
      cap.appendChild(words);
      root.appendChild(cap);
    }

    mount.appendChild(root);
    return { root, body, controls };
  };

  // ------------------------------------------------------------- quantity

  /** One big number with a label and a line of context. */
  ns.createStat = function createStat(spec) {
    const mount = resolveMount(spec && spec.mount, 'createStat');
    const wrap = el('div', 'ex-stats');
    for (const s of spec.items || []) {
      const card = el('div', 'ex-stat');
      card.appendChild(el('span', 'ex-stat-v', s.value == null ? '—' : String(s.value)));
      card.appendChild(el('span', 'ex-stat-l', s.label || ''));
      if (s.note) card.appendChild(el('span', 'ex-stat-n', s.note));
      if (s.outcomeId) card.querySelector('.ex-stat-v').setAttribute('data-outcome', s.outcomeId);
      wrap.appendChild(card);
    }
    mount.appendChild(wrap);
    return wrap;
  };

  /** Horizontal bars — comparing magnitudes across a handful of named things. */
  ns.createBars = function createBars(spec) {
    const mount = resolveMount(spec && spec.mount, 'createBars');
    const items = (spec.items || []).map((d, i) => ({
      label: String(d.label == null ? i : d.label),
      value: num(d.value, 0, `createBars item ${i}`),
      colour: d.colour || null,
    }));
    const w = 640;
    const rowH = 30;
    const labelW = num(spec.labelWidth, 150, 'createBars labelWidth');
    const h = Math.max(rowH, items.length * rowH) + 12;
    const svg = frameSvg(w, h, spec.title || 'Bar comparison');
    const max = Math.max(1, ...items.map((d) => Math.abs(d.value)));
    const trackW = w - labelW - 70;

    items.forEach((d, i) => {
      const y = i * rowH + 6;
      svg.appendChild(
        textEl(labelW - 8, y + rowH / 2, d.label, {
          anchor: 'end',
          baseline: 'middle',
          size: 12,
          fill: 'var(--ex-ink-soft)',
        }),
      );
      svg.appendChild(
        svgEl('rect', {
          x: labelW, y: y + 4, width: trackW, height: rowH - 14,
          fill: 'var(--ex-rule-faint)', rx: 1,
        }),
      );
      const bw = Math.max(1, (Math.abs(d.value) / max) * trackW);
      svg.appendChild(
        svgEl('rect', {
          x: labelW, y: y + 4, width: bw, height: rowH - 14,
          fill: d.colour || (spec.tone ? spec.tone : cat(i)), rx: 1,
        }),
      );
      svg.appendChild(
        textEl(labelW + bw + 8, y + rowH / 2, spec.format ? spec.format(d.value) : d.value, {
          baseline: 'middle', size: 11, mono: true, fill: 'var(--ex-ink-muted)',
        }),
      );
    });
    mount.appendChild(svg);
    return svg;
  };

  /** A single stacked bar — the composition of one whole. */
  ns.createStackBar = function createStackBar(spec) {
    const mount = resolveMount(spec && spec.mount, 'createStackBar');
    const parts = (spec.parts || []).map((p, i) => ({
      label: String(p.label == null ? i : p.label),
      value: Math.max(0, num(p.value, 0, `createStackBar part ${i}`)),
      colour: p.colour || cat(i),
    }));
    const total = parts.reduce((a, p) => a + p.value, 0) || 1;
    const w = 640;
    const barH = 34;
    const svg = frameSvg(w, barH + 46, spec.title || 'Composition');

    let x = 0;
    parts.forEach((p) => {
      const pw = (p.value / total) * w;
      svg.appendChild(svgEl('rect', { x, y: 0, width: Math.max(0, pw), height: barH, fill: p.colour }));
      if (pw > 44) {
        svg.appendChild(
          textEl(x + pw / 2, barH / 2, `${Math.round((p.value / total) * 100)}%`, {
            anchor: 'middle', baseline: 'middle', size: 11, mono: true, fill: 'var(--ex-surface)', weight: 600,
          }),
        );
      }
      x += pw;
    });

    // Legend beneath, because labels inside a thin segment are unreadable.
    let lx = 0;
    parts.forEach((p) => {
      const g = svgEl('g', {});
      g.appendChild(svgEl('rect', { x: lx, y: barH + 14, width: 9, height: 9, fill: p.colour }));
      g.appendChild(textEl(lx + 14, barH + 22, p.label, { baseline: 'middle', size: 11, fill: 'var(--ex-ink-soft)' }));
      svg.appendChild(g);
      lx += 22 + Math.max(40, p.label.length * 6.2);
    });
    mount.appendChild(svg);
    return svg;
  };

  /**
   * An icon array — N units, some highlighted.
   *
   * The clearest way to show a proportion or a risk to a non-specialist: "7 in
   * 100" reads immediately where "7%" does not.
   */
  ns.createIconArray = function createIconArray(spec) {
    const mount = resolveMount(spec && spec.mount, 'createIconArray');
    const total = Math.max(1, Math.round(num(spec.total, 100, 'createIconArray total')));
    const filled = Math.max(0, Math.min(total, Math.round(num(spec.filled, 0, 'createIconArray filled'))));
    const perRow = Math.max(1, Math.round(num(spec.perRow, 10, 'createIconArray perRow')));
    const r = 5;
    const gap = 14;
    const rows = Math.ceil(total / perRow);
    const w = perRow * gap;
    const svg = frameSvg(w, rows * gap + 6, spec.title || `${filled} in ${total}`);

    for (let i = 0; i < total; i++) {
      svg.appendChild(
        svgEl('circle', {
          cx: (i % perRow) * gap + r + 1,
          cy: Math.floor(i / perRow) * gap + r + 1,
          r,
          fill: i < filled ? spec.tone || 'var(--ex-accent)' : 'var(--ex-rule)',
        }),
      );
    }
    mount.appendChild(svg);
    return svg;
  };

  /** A proportion against a target — one arc, one number. */
  ns.createGauge = function createGauge(spec) {
    const mount = resolveMount(spec && spec.mount, 'createGauge');
    const value = num(spec.value, 0, 'createGauge value');
    const max = Math.max(1e-9, num(spec.max, 100, 'createGauge max'));
    const frac = Math.max(0, Math.min(1, value / max));
    const w = 220;
    const h = 130;
    const cx = w / 2;
    const cy = h - 18;
    const R = 84;
    const svg = frameSvg(w, h, spec.title || 'Gauge');

    const arc = (from, to, colour, width) => {
      const a0 = Math.PI + from * Math.PI;
      const a1 = Math.PI + to * Math.PI;
      // Always 0. The gauge is a semicircle, so a sweep can never exceed 180°
      // and the large-arc flag must never be set. Setting it past the halfway
      // point sent the renderer the long way round and drew the value as two
      // disconnected stubs at opposite ends of the dial — which looked like a
      // styling quirk rather than a wrong number, and would have shipped.
      const large = 0;
      return svgEl('path', {
        d: `M ${cx + R * Math.cos(a0)} ${cy + R * Math.sin(a0)} A ${R} ${R} 0 ${large} 1 ${cx + R * Math.cos(a1)} ${cy + R * Math.sin(a1)}`,
        fill: 'none', stroke: colour, 'stroke-width': width, 'stroke-linecap': 'butt',
      });
    };
    svg.appendChild(arc(0, 1, 'var(--ex-rule-faint)', 14));
    if (frac > 0) svg.appendChild(arc(0, frac, spec.tone || 'var(--ex-accent)', 14));

    const label = textEl(cx, cy - 18, spec.format ? spec.format(value) : value, {
      anchor: 'middle', size: 26, weight: 600, mono: true,
    });
    if (spec.outcomeId) label.setAttribute('data-outcome', spec.outcomeId);
    svg.appendChild(label);
    if (spec.unit) {
      svg.appendChild(textEl(cx, cy + 2, spec.unit, { anchor: 'middle', size: 11, fill: 'var(--ex-ink-muted)' }));
    }
    mount.appendChild(svg);
    return svg;
  };

  // -------------------------------------------------------------- process

  /**
   * A process as numbered steps, left to right, with arrows between.
   *
   * The default way to answer "how does this work?" — and the artefact most
   * often wanted when a chapter reaches for a 3D scene it does not need.
   */
  ns.createSteps = function createSteps(spec) {
    const mount = resolveMount(spec && spec.mount, 'createSteps');
    const steps = spec.steps || [];
    if (steps.length === 0) return mount;
    const w = 660;
    const gap = 16;
    const boxW = Math.max(70, (w - gap * (steps.length - 1)) / steps.length);
    const boxH = 74;
    const svg = frameSvg(w, boxH + 34, spec.title || 'Process');

    steps.forEach((s, i) => {
      const x = i * (boxW + gap);
      const g = svgEl('g', {});
      g.appendChild(
        svgEl('rect', {
          x, y: 16, width: boxW, height: boxH, rx: 2,
          fill: 'var(--ex-surface)', stroke: s.tone || 'var(--ex-accent)', 'stroke-width': 1,
        }),
      );
      g.appendChild(
        svgEl('rect', { x, y: 16, width: boxW, height: 3, fill: s.tone || 'var(--ex-accent)' }),
      );
      g.appendChild(
        textEl(x + 8, 12, String(i + 1), { size: 10, mono: true, fill: 'var(--ex-accent)' }),
      );
      wrapText(g, s.label || '', x + 8, 40, boxW - 16, 12, 3);
      if (s.note) {
        wrapText(g, s.note, x + 8, boxH + 2, boxW - 16, 10, 1, 'var(--ex-ink-muted)');
      }
      svg.appendChild(g);

      if (i < steps.length - 1) {
        const ax = x + boxW + 3;
        svg.appendChild(
          svgEl('path', {
            d: `M ${ax} ${16 + boxH / 2} L ${ax + gap - 6} ${16 + boxH / 2}`,
            stroke: 'var(--ex-ink-muted)', 'stroke-width': 1.5,
            'marker-end': `url(#${arrowMarker(svg)})`,
          }),
        );
      }
    });
    mount.appendChild(svg);
    return svg;
  };

  /** A repeating process — the same as steps, but round, with no end. */
  ns.createCycle = function createCycle(spec) {
    const mount = resolveMount(spec && spec.mount, 'createCycle');
    const steps = spec.steps || [];
    if (steps.length < 2) {
      console.error('[explainer-kit] createCycle needs at least two steps.');
      return mount;
    }
    const size = 380;
    const cx = size / 2;
    const cy = size / 2;
    const R = 118;
    const svg = frameSvg(size, size, spec.title || 'Cycle');

    svg.appendChild(
      svgEl('circle', { cx, cy, r: R, fill: 'none', stroke: 'var(--ex-rule)', 'stroke-width': 1, 'stroke-dasharray': '3 5' }),
    );

    steps.forEach((s, i) => {
      const a = (i / steps.length) * Math.PI * 2 - Math.PI / 2;
      const x = cx + R * Math.cos(a);
      const y = cy + R * Math.sin(a);
      svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 17, fill: s.tone || 'var(--ex-accent)' }));
      svg.appendChild(
        textEl(x, y, String(i + 1), {
          anchor: 'middle', baseline: 'middle', size: 12, mono: true, fill: 'var(--ex-surface)', weight: 600,
        }),
      );
      // Push the label outward from the centre so it never sits over the ring.
      const lx = cx + (R + 30) * Math.cos(a);
      const ly = cy + (R + 30) * Math.sin(a);
      const anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
      svg.appendChild(
        textEl(lx, ly, s.label || '', { anchor, baseline: 'middle', size: 12, fill: 'var(--ex-ink)' }),
      );
    });
    mount.appendChild(svg);
    return svg;
  };

  /** A narrowing flow — how many survive each stage. */
  ns.createFunnel = function createFunnel(spec) {
    const mount = resolveMount(spec && spec.mount, 'createFunnel');
    const stages = (spec.stages || []).map((s, i) => ({
      label: String(s.label == null ? i : s.label),
      value: Math.max(0, num(s.value, 0, `createFunnel stage ${i}`)),
    }));
    if (stages.length === 0) return mount;
    const w = 620;
    const rowH = 46;
    const svg = frameSvg(w, stages.length * rowH + 10, spec.title || 'Funnel');
    const top = Math.max(1, stages[0].value);
    const labelW = 170;
    const trackW = w - labelW - 80;

    stages.forEach((s, i) => {
      const y = i * rowH + 6;
      const bw = Math.max(2, (s.value / top) * trackW);
      const x = labelW + (trackW - bw) / 2;
      svg.appendChild(
        textEl(labelW - 10, y + 16, s.label, { anchor: 'end', baseline: 'middle', size: 12, fill: 'var(--ex-ink-soft)' }),
      );
      svg.appendChild(svgEl('rect', { x, y, width: bw, height: 32, rx: 1, fill: ramp(1 - i / stages.length) }));
      svg.appendChild(
        textEl(labelW + trackW + 10, y + 16, spec.format ? spec.format(s.value) : s.value, {
          baseline: 'middle', size: 11, mono: true, fill: 'var(--ex-ink-muted)',
        }),
      );
      if (i > 0 && stages[i - 1].value > 0) {
        const drop = Math.round((1 - s.value / stages[i - 1].value) * 100);
        if (drop > 0) {
          svg.appendChild(
            textEl(labelW + trackW / 2, y - 2, `−${drop}%`, {
              anchor: 'middle', size: 9, mono: true, fill: 'var(--ex-bad)',
            }),
          );
        }
      }
    });
    mount.appendChild(svg);
    return svg;
  };

  /** Events along a horizontal axis. */
  ns.createTimeline = function createTimeline(spec) {
    const mount = resolveMount(spec && spec.mount, 'createTimeline');
    const events = (spec.events || []).map((e, i) => ({
      at: num(e.at, i, `createTimeline event ${i}`),
      label: String(e.label == null ? '' : e.label),
      tone: e.tone || null,
    }));
    if (events.length === 0) return mount;
    const w = 660;
    const h = 116;
    const svg = frameSvg(w, h, spec.title || 'Timeline');
    // Wide enough that the first and last labels, which are centred on their
    // marker, still fit inside the viewBox. At pad 40 "Formula introduced"
    // rendered as "rmula introduced", clipped at the left edge — a fault that
    // is invisible unless you look at the picture.
    const pad = 76;
    const lo = Math.min(...events.map((e) => e.at));
    const hi = Math.max(...events.map((e) => e.at));
    const sx = (v) => pad + ((v - lo) / (hi - lo || 1)) * (w - pad * 2);
    const axisY = h - 40;
    /** Keep a centred label inside the box however long it is. */
    const clampLabel = (x, text) => {
      const half = String(text).length * 3.2;
      return Math.max(half + 2, Math.min(w - half - 2, x));
    };

    svg.appendChild(
      svgEl('line', { x1: pad, y1: axisY, x2: w - pad, y2: axisY, stroke: 'var(--ex-rule)', 'stroke-width': 1 }),
    );
    events.forEach((e, i) => {
      const x = sx(e.at);
      // Alternate above/below so dense clusters stay readable.
      const up = i % 2 === 0;
      const ly = up ? axisY - 22 : axisY + 20;
      svg.appendChild(
        svgEl('line', { x1: x, y1: axisY, x2: x, y2: up ? ly + 6 : ly - 10, stroke: 'var(--ex-rule)', 'stroke-width': 1 }),
      );
      svg.appendChild(svgEl('circle', { cx: x, cy: axisY, r: 4, fill: e.tone || 'var(--ex-accent)' }));
      svg.appendChild(
        textEl(clampLabel(x, e.label), ly, e.label, {
          anchor: 'middle', baseline: up ? 'auto' : 'hanging', size: 11, fill: 'var(--ex-ink)',
        }),
      );
      svg.appendChild(
        textEl(x, axisY + (up ? 16 : -8), spec.format ? spec.format(e.at) : e.at, {
          anchor: 'middle', size: 9, mono: true, fill: 'var(--ex-ink-muted)',
        }),
      );
    });
    mount.appendChild(svg);
    return svg;
  };

  // ------------------------------------------------------------ structure

  /** A 2×2 (or n×m) grid — positioning things on two axes. */
  ns.createMatrix = function createMatrix(spec) {
    const mount = resolveMount(spec && spec.mount, 'createMatrix');
    const size = 420;
    const pad = 54;
    const svg = frameSvg(size, size, spec.title || 'Matrix');
    const inner = size - pad * 2;

    svg.appendChild(svgEl('rect', { x: pad, y: pad, width: inner, height: inner, fill: 'var(--ex-rule-faint)' }));
    svg.appendChild(
      svgEl('line', { x1: pad + inner / 2, y1: pad, x2: pad + inner / 2, y2: pad + inner, stroke: 'var(--ex-rule)' }),
    );
    svg.appendChild(
      svgEl('line', { x1: pad, y1: pad + inner / 2, x2: pad + inner, y2: pad + inner / 2, stroke: 'var(--ex-rule)' }),
    );
    svg.appendChild(textEl(pad + inner / 2, size - 16, spec.xLabel || '', { anchor: 'middle', size: 11, mono: true, fill: 'var(--ex-ink-muted)' }));
    const yl = textEl(16, pad + inner / 2, spec.yLabel || '', { anchor: 'middle', size: 11, mono: true, fill: 'var(--ex-ink-muted)' });
    yl.setAttribute('transform', `rotate(-90 16 ${pad + inner / 2})`);
    svg.appendChild(yl);

    for (const p of spec.points || []) {
      const px = pad + Math.max(0, Math.min(1, num(p.x, 0.5, 'createMatrix point x'))) * inner;
      const py = pad + (1 - Math.max(0, Math.min(1, num(p.y, 0.5, 'createMatrix point y')))) * inner;
      svg.appendChild(svgEl('circle', { cx: px, cy: py, r: 6, fill: p.tone || 'var(--ex-accent)' }));
      svg.appendChild(textEl(px + 10, py, p.label || '', { baseline: 'middle', size: 11 }));
    }
    mount.appendChild(svg);
    return svg;
  };

  /** A hierarchy, drawn top-down. `root` is { label, children: [...] }. */
  ns.createTree = function createTree(spec) {
    const mount = resolveMount(spec && spec.mount, 'createTree');
    const root = spec.root;
    if (!root) {
      console.error('[explainer-kit] createTree: spec.root is required');
      return mount;
    }
    const levels = [];
    (function walk(node, depth) {
      (levels[depth] = levels[depth] || []).push(node);
      for (const c of node.children || []) walk(c, depth + 1);
    })(root, 0);

    const w = 660;
    const rowH = 78;
    const h = levels.length * rowH + 10;
    const svg = frameSvg(w, h, spec.title || 'Hierarchy');
    const pos = new Map();

    levels.forEach((nodes, d) => {
      const slot = w / nodes.length;
      nodes.forEach((n, i) => {
        pos.set(n, { x: slot * i + slot / 2, y: d * rowH + 26 });
      });
    });

    // Edges first so boxes sit on top of them.
    (function edges(node) {
      const from = pos.get(node);
      for (const c of node.children || []) {
        const to = pos.get(c);
        svg.appendChild(
          svgEl('path', {
            d: `M ${from.x} ${from.y + 16} C ${from.x} ${from.y + 44}, ${to.x} ${to.y - 40}, ${to.x} ${to.y - 16}`,
            fill: 'none', stroke: 'var(--ex-rule)', 'stroke-width': 1.2,
          }),
        );
        edges(c);
      }
    })(root);

    for (const [node, p] of pos) {
      const label = String(node.label == null ? '' : node.label);
      const bw = Math.max(64, Math.min(150, label.length * 7 + 20));
      svg.appendChild(
        svgEl('rect', {
          x: p.x - bw / 2, y: p.y - 15, width: bw, height: 30, rx: 2,
          fill: 'var(--ex-surface)', stroke: node.tone || 'var(--ex-accent)', 'stroke-width': 1,
        }),
      );
      svg.appendChild(textEl(p.x, p.y, label, { anchor: 'middle', baseline: 'middle', size: 11 }));
    }
    mount.appendChild(svg);
    return svg;
  };

  /** Two or three overlapping sets. */
  ns.createVenn = function createVenn(spec) {
    const mount = resolveMount(spec && spec.mount, 'createVenn');
    const sets = (spec.sets || []).slice(0, 3);
    if (sets.length < 2) {
      console.error('[explainer-kit] createVenn needs two or three sets.');
      return mount;
    }
    const w = 420;
    const h = sets.length === 2 ? 250 : 320;
    const svg = frameSvg(w, h, spec.title || 'Overlap');
    const r = 88;
    const centres =
      sets.length === 2
        ? [
            { x: w / 2 - 52, y: h / 2 - 10 },
            { x: w / 2 + 52, y: h / 2 - 10 },
          ]
        : [
            { x: w / 2 - 56, y: h / 2 - 34 },
            { x: w / 2 + 56, y: h / 2 - 34 },
            { x: w / 2, y: h / 2 + 48 },
          ];

    sets.forEach((s, i) => {
      svg.appendChild(
        svgEl('circle', {
          cx: centres[i].x, cy: centres[i].y, r,
          fill: s.tone || cat(i), 'fill-opacity': 0.28,
          stroke: s.tone || cat(i), 'stroke-width': 1.5,
        }),
      );
    });
    sets.forEach((s, i) => {
      const c = centres[i];
      const outward = sets.length === 2 ? (i === 0 ? -1 : 1) : i === 2 ? 0 : i === 0 ? -1 : 1;
      svg.appendChild(
        textEl(c.x + outward * (r - 26), c.y + (sets.length === 3 && i === 2 ? r - 24 : 0), s.label || '', {
          anchor: 'middle', baseline: 'middle', size: 12, weight: 600,
        }),
      );
    });
    if (spec.overlapLabel) {
      const ox = sets.length === 2 ? w / 2 : w / 2;
      const oy = sets.length === 2 ? h / 2 - 10 : h / 2 - 4;
      svg.appendChild(
        textEl(ox, oy, spec.overlapLabel, { anchor: 'middle', baseline: 'middle', size: 11, fill: 'var(--ex-ink)' }),
      );
    }
    mount.appendChild(svg);
    return svg;
  };

  /** A series with an uncertainty band — a projection with its error bars. */
  ns.createLineBand = function createLineBand(spec) {
    const mount = resolveMount(spec && spec.mount, 'createLineBand');
    const pts = (spec.points || []).map((p, i) => ({
      x: num(p.x, i, `createLineBand point ${i} x`),
      y: num(p.y, 0, `createLineBand point ${i} y`),
      lo: p.lo == null ? null : num(p.lo, 0, `createLineBand point ${i} lo`),
      hi: p.hi == null ? null : num(p.hi, 0, `createLineBand point ${i} hi`),
    }));
    if (pts.length < 2) {
      console.error('[explainer-kit] createLineBand needs at least two points.');
      return mount;
    }
    const w = 640;
    const h = 280;
    const pad = { t: 14, r: 16, b: 34, l: 52 };
    const svg = frameSvg(w, h, spec.title || 'Series');
    const xs = pts.map((p) => p.x);
    const ys = pts.flatMap((p) => [p.y, p.lo, p.hi].filter((v) => v != null));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(0, ...ys);
    const y1 = Math.max(...ys);
    const sx = (v) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);
    const sy = (v) => h - pad.b - ((v - y0) / (y1 - y0 || 1)) * (h - pad.t - pad.b);

    svg.appendChild(svgEl('line', { x1: pad.l, y1: h - pad.b, x2: w - pad.r, y2: h - pad.b, stroke: 'var(--ex-rule)' }));
    svg.appendChild(svgEl('line', { x1: pad.l, y1: pad.t, x2: pad.l, y2: h - pad.b, stroke: 'var(--ex-rule)' }));

    if (pts.every((p) => p.lo != null && p.hi != null)) {
      const up = pts.map((p) => `${sx(p.x)},${sy(p.hi)}`).join(' L ');
      const down = pts.slice().reverse().map((p) => `${sx(p.x)},${sy(p.lo)}`).join(' L ');
      svg.appendChild(
        svgEl('path', { d: `M ${up} L ${down} Z`, fill: spec.tone || 'var(--ex-accent)', 'fill-opacity': 0.16 }),
      );
    }
    svg.appendChild(
      svgEl('path', {
        d: `M ${pts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' L ')}`,
        fill: 'none', stroke: spec.tone || 'var(--ex-accent)', 'stroke-width': 2,
      }),
    );
    // Emphasise the endpoint — the value a reader is usually after.
    const last = pts[pts.length - 1];
    svg.appendChild(svgEl('circle', { cx: sx(last.x), cy: sy(last.y), r: 4, fill: spec.tone || 'var(--ex-accent)' }));
    svg.appendChild(textEl(pad.l - 8, sy(y1), spec.format ? spec.format(y1) : y1, { anchor: 'end', size: 10, mono: true, fill: 'var(--ex-ink-muted)' }));
    svg.appendChild(textEl(pad.l - 8, h - pad.b, spec.format ? spec.format(y0) : y0, { anchor: 'end', size: 10, mono: true, fill: 'var(--ex-ink-muted)' }));
    mount.appendChild(svg);
    return svg;
  };

  /** Before and after, as paired bars with the change called out. */
  ns.createComparison = function createComparison(spec) {
    const mount = resolveMount(spec && spec.mount, 'createComparison');
    const rows = (spec.rows || []).map((r, i) => ({
      label: String(r.label == null ? i : r.label),
      before: num(r.before, 0, `createComparison row ${i} before`),
      after: num(r.after, 0, `createComparison row ${i} after`),
    }));
    const w = 640;
    const rowH = 44;
    const svg = frameSvg(w, rows.length * rowH + 26, spec.title || 'Before and after');
    const labelW = 150;
    const trackW = w - labelW - 90;
    const max = Math.max(1, ...rows.flatMap((r) => [Math.abs(r.before), Math.abs(r.after)]));

    svg.appendChild(textEl(labelW, 10, spec.beforeLabel || 'before', { size: 9, mono: true, fill: 'var(--ex-ink-muted)' }));
    svg.appendChild(textEl(labelW + 70, 10, spec.afterLabel || 'after', { size: 9, mono: true, fill: 'var(--ex-ink-muted)' }));

    rows.forEach((r, i) => {
      const y = i * rowH + 20;
      svg.appendChild(textEl(labelW - 8, y + 14, r.label, { anchor: 'end', baseline: 'middle', size: 12, fill: 'var(--ex-ink-soft)' }));
      svg.appendChild(svgEl('rect', { x: labelW, y, width: Math.max(1, (Math.abs(r.before) / max) * trackW), height: 11, fill: 'var(--ex-rule)' }));
      svg.appendChild(svgEl('rect', { x: labelW, y: y + 15, width: Math.max(1, (Math.abs(r.after) / max) * trackW), height: 11, fill: spec.tone || 'var(--ex-accent)' }));
      const delta = r.after - r.before;
      const pct = r.before === 0 ? null : Math.round((delta / Math.abs(r.before)) * 100);
      svg.appendChild(
        textEl(w - 6, y + 14, pct == null ? '—' : `${pct > 0 ? '+' : ''}${pct}%`, {
          anchor: 'end', baseline: 'middle', size: 11, mono: true,
          fill: delta === 0 ? 'var(--ex-ink-muted)' : delta > 0 ? 'var(--ex-good)' : 'var(--ex-bad)',
        }),
      );
    });
    mount.appendChild(svg);
    return svg;
  };

  // --------------------------------------------------------------- shared

  let markerSeq = 0;
  /** One arrowhead marker per svg, created on demand. Returns its id. */
  function arrowMarker(svg) {
    let defs = svg.querySelector('defs');
    if (defs && defs.dataset && defs.dataset.arrow) return defs.dataset.arrow;
    const id = `ex-arrow-${++markerSeq}`;
    defs = defs || svgEl('defs', {});
    const m = svgEl('marker', {
      id, viewBox: '0 0 8 8', refX: 7, refY: 4,
      markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse',
    });
    m.appendChild(svgEl('path', { d: 'M 0 0 L 8 4 L 0 8 z', fill: 'var(--ex-ink-muted)' }));
    defs.appendChild(m);
    defs.dataset.arrow = id;
    svg.insertBefore(defs, svg.firstChild);
    return id;
  }

  /**
   * Naive word wrap. SVG has no text flow, so long labels either overflow the
   * box or need breaking by hand; this breaks them.
   */
  function wrapText(parent, str, x, y, maxWidth, size, maxLines, fill) {
    const words = String(str).split(/\s+/).filter(Boolean);
    const perChar = size * 0.55;
    const perLine = Math.max(1, Math.floor(maxWidth / perChar));
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length > perLine && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
      if (lines.length >= maxLines) break;
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
      lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, perLine - 1))}…`;
    }
    lines.forEach((l, i) => {
      parent.appendChild(textEl(x, y + i * (size + 3), l, { size, fill: fill || 'var(--ex-ink)' }));
    });
  }
})();
