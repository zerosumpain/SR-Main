/* Explainer kit — causal / system diagrams.
 * Ported from policy-engine's CausalFlow.svelte, framework-free.
 * Nodes carry data-node="<id>"; edges carry data-edge="<from>__<to>".
 */
(function () {
  const ns = (window.Explainer = window.Explainer || {});
  const SVG = 'http://www.w3.org/2000/svg';
  let _seq = 0;

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

    const markerId = 'ex-arrow-' + (++_seq);
    const w = spec.width || 720;
    const h = spec.height || 380;
    const svg = svgEl('svg', {
      viewBox: `0 0 ${w} ${h}`,
      width: '100%',
      role: spec.onNodeClick ? 'group' : 'img',
      'aria-label': spec.title || 'Causal diagram',
    });

    const defs = svgEl('defs', {});
    const marker = svgEl('marker', {
      id: markerId, viewBox: '0 0 10 10', refX: '9', refY: '5',
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
        'marker-end': `url(#${markerId})`,
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
      const attrs = { 'data-node': n.id, class: 'ex-node' };
      if (spec.onNodeClick) {
        attrs.tabindex = '0';
        attrs.role = 'button';
        attrs['aria-label'] = n.label;
      }
      const g = svgEl('g', attrs);
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
        g.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            spec.onNodeClick(n.id);
          }
        });
      }
      nodeLayer.appendChild(g);
    }

    mount.appendChild(svg);

    return {
      setWeight(from, to, weight) {
        const line = edgeEls[from + '__' + to];
        if (line) {
          const w = weight ?? 1;
          line.setAttribute('stroke-width', String(Math.max(1, Math.min(8, w * 3))));
        }
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
