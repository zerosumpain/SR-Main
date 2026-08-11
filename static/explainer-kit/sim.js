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
    // A text outcome is legitimate and common — "what this establishes",
    // "which rule applies" — and returning the em-dash for it made a working
    // model look like a dead one: the readout never left "—", and the checker
    // duly reported an inert lever with a remedy telling the author to wire
    // step() to the lever. It already was. Only genuinely absent values get
    // the placeholder now.
    if (typeof n === 'string') return n;
    if (n == null) return '—';
    if (typeof n === 'boolean') return n ? 'Yes' : 'No';
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

    /** Per-lever programmatic setters, so `set()` works for every kind. */
    const setters = {};

    for (const l of levers) {
      controls.appendChild(buildLever(l));
    }

    /**
     * Build one control.
     *
     * `kind` decides the shape. It used to be hardcoded to a range input, so
     * every chapter of every build got a slider whatever the parameter was —
     * a slider for "which of six topics", a slider for "before or after". The
     * house style this kit copies uses buttons over sliders 43 to 10, and a
     * slider is only honest for a genuinely CONTINUOUS quantity.
     *
     *   choice  — segmented buttons, one per option. THE DEFAULT.
     *   toggle  — one button, on or off.
     *   step    — previous/next through an ordered sequence.
     *   slider  — a continuous range. Only for quantities.
     *
     * In every case `data-lever` marks the element the checker drives, and the
     * value written into `values[l.id]` is what `step()` receives.
     */
    function buildLever(l) {
      const kind = l.kind || (l.options ? 'choice' : l.min != null && l.max != null ? 'slider' : 'choice');
      const wrap = el('div', 'ex-lever ex-lever-' + kind);
      wrap.appendChild(el('span', 'ex-lever-label', l.label));

      if (kind === 'slider') {
        // A <label> wrapper would associate the text with the input; keep that
        // behaviour for the one control where it is a form field.
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(l.min);
        input.max = String(l.max);
        input.step = String(l.step ?? 1);
        input.value = String(l.value);
        input.setAttribute('data-lever', l.id);
        input.setAttribute('aria-label', l.label);
        const shown = el('output', 'ex-lever-value', l.value + (l.unit || ''));
        input.addEventListener('input', () => {
          values[l.id] = Number(input.value);
          shown.textContent = input.value + (l.unit || '');
          recompute();
        });
        setters[l.id] = (v) => {
          input.value = String(v);
          input.dispatchEvent(new Event('input'));
        };
        wrap.appendChild(input);
        wrap.appendChild(shown);
        return wrap;
      }

      const options = normaliseOptions(l, kind);
      values[l.id] = options[indexOfValue(options, l.value)].value;

      if (kind === 'toggle') {
        const on = options[1] ?? options[0];
        const off = options[0];
        const btn = el('button', 'ex-toggle');
        btn.type = 'button';
        btn.setAttribute('data-lever', l.id);
        let isOn = values[l.id] === on.value;
        const paintBtn = () => {
          btn.setAttribute('aria-pressed', String(isOn));
          btn.textContent = isOn ? on.label : off.label;
        };
        paintBtn();
        btn.addEventListener('click', () => {
          isOn = !isOn;
          values[l.id] = (isOn ? on : off).value;
          paintBtn();
          recompute();
        });
        setters[l.id] = (v) => {
          isOn = v === on.value;
          values[l.id] = (isOn ? on : off).value;
          paintBtn();
          recompute();
        };
        wrap.appendChild(btn);
        return wrap;
      }

      if (kind === 'step') {
        let i = indexOfValue(options, l.value);
        const group = el('div', 'ex-step-ctl');
        group.setAttribute('data-lever', l.id);
        const prev = el('button', 'ex-step-btn', '‹');
        const next = el('button', 'ex-step-btn', '›');
        prev.type = next.type = 'button';
        prev.setAttribute('aria-label', 'Previous');
        next.setAttribute('aria-label', 'Next');
        const shown = el('span', 'ex-step-now');
        const paintStep = () => {
          shown.textContent = `${options[i].label} · ${i + 1}/${options.length}`;
          prev.disabled = i === 0;
          next.disabled = i === options.length - 1;
        };
        const go = (d) => {
          i = Math.max(0, Math.min(options.length - 1, i + d));
          values[l.id] = options[i].value;
          paintStep();
          recompute();
        };
        prev.addEventListener('click', () => go(-1));
        next.addEventListener('click', () => go(1));
        paintStep();
        setters[l.id] = (v) => {
          i = indexOfValue(options, v);
          values[l.id] = options[i].value;
          paintStep();
          recompute();
        };
        group.append(prev, shown, next);
        wrap.appendChild(group);
        return wrap;
      }

      // choice — the default
      const group = el('div', 'ex-seg');
      group.setAttribute('data-lever', l.id);
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', l.label);
      const btns = options.map((o, idx) => {
        const b = el('button', 'ex-seg-btn', o.label);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(o.value === values[l.id]));
        b.addEventListener('click', () => {
          values[l.id] = o.value;
          // aria-checked is what the checker reads to find an option that is
          // NOT current; keeping it accurate is load-bearing, not decorative.
          btns.forEach((x, j) => x.setAttribute('aria-checked', String(j === idx)));
          recompute();
        });
        return b;
      });
      setters[l.id] = (v) => {
        const idx = indexOfValue(options, v);
        values[l.id] = options[idx].value;
        btns.forEach((x, j) => x.setAttribute('aria-checked', String(j === idx)));
        recompute();
      };
      group.append(...btns);
      wrap.appendChild(group);
      return wrap;
    }

    /** Accept options as strings, numbers, or {value,label}. */
    function normaliseOptions(l, kind) {
      let raw = l.options;
      if (!Array.isArray(raw) || raw.length === 0) {
        // A choice with no options is a mistake worth naming: falling back to
        // a silent single button would look like a working control.
        if (kind === 'toggle') raw = [{ value: 0, label: 'Off' }, { value: 1, label: 'On' }];
        else if (l.min != null && l.max != null) {
          raw = [];
          for (let v = Number(l.min); v <= Number(l.max); v += Number(l.step ?? 1)) raw.push(v);
        } else {
          console.error(`[explainer-kit] createSim lever "${l.id}": ${kind} needs an options array.`);
          raw = [{ value: l.value ?? 0, label: String(l.value ?? '—') }];
        }
      }
      return raw.map((o) =>
        o != null && typeof o === 'object'
          ? { value: o.value, label: String(o.label ?? o.value) }
          : { value: o, label: String(o) },
      );
    }

    function indexOfValue(options, want) {
      const i = options.findIndex((o) => o.value === want);
      return i === -1 ? 0 : i;
    }

    recompute();

    return {
      values,
      /**
       * Set a lever programmatically and repaint its control.
       *
       * Each kind registers its own setter at build time. The old version
       * assigned `.value` and dispatched 'input', which only ever worked for
       * the range input — on a segmented group or a toggle it silently set a
       * property nothing reads, and the control kept displaying the old state
       * while the model used the new one.
       */
      set(id, v) {
        const apply = setters[id];
        if (apply) apply(v);
        else { values[id] = v; recompute(); }
      },
      recompute,
      destroy() { root.remove(); },
    };
  };
})();
