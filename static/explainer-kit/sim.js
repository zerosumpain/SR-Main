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

    // Monotonic run counter — see the ordering guard in recompute below.
    let runSeq = 0;

    // Paint + emit for one completed model run. Split out of recompute so the
    // synchronous and the promise-resolved paths do exactly the same thing.
    function paint(result, snapshot) {
      for (const o of outcomes) {
        const fmt = o.format || defaultFormat;
        outEls[o.id].textContent = fmt(result[o.id]);
      }
      try {
        window.parent.postMessage(
          { type: 'lever_changed', ts: Date.now(), values: snapshot, outcomes: result },
          '*',
        );
      } catch (e) { /* not embedded */ }
      if (window.JKAI_EVENTS_URL) {
        fetch(window.JKAI_EVENTS_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ type: 'lever_changed', ts: Date.now(), values: snapshot, outcomes: result }),
        }).catch(() => {});
      }
    }

    // Returns a promise when step() is async, so a caller that needs the paint
    // to have happened can await it; the synchronous path is unchanged and
    // still paints before returning.
    function recompute() {
      const snapshot = { ...values };
      let result;
      try {
        result = step(snapshot);
      } catch (err) {
        for (const o of outcomes) outEls[o.id].textContent = 'error';
        console.error('[explainer] step() threw', err);
        return;
      }
      // An async step() returns a thenable. It is truthy, so `|| {}` never
      // catches it and every outcome would render the em-dash placeholder for
      // the life of the page — which the gate then reports as an inert lever,
      // with a remedy telling the author to make the outcome depend on the
      // lever. It already does; it is just not awaited. So: await it.
      if (result && typeof result.then === 'function') {
        // Ordering guard: a slider drag fires many 'input' events, and two
        // in-flight async runs can settle out of order. Only the newest run may
        // paint, so the readout can never end up showing a superseded result.
        const myRun = ++runSeq;
        return result.then(
          (settled) => { if (myRun === runSeq) paint(settled || {}, snapshot); },
          (err) => {
            if (myRun !== runSeq) return;
            for (const o of outcomes) outEls[o.id].textContent = 'error';
            console.error('[explainer] async step() rejected — outcomes cannot be painted', err);
          },
        );
      }
      runSeq++;
      paint(result || {}, snapshot);
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
