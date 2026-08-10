/* Explainer kit — charts. Line and bar only; six series maximum.
 * Colours come from --ex-cat-N so the whole project reads as one system.
 * Series marks carry data-series="<id>" so a chapter or a gate can query them.
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
          s.points.forEach((p) => {
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
