/* Explainer kit — evidence-aware cohort simulator. Requires sim.js. */
(function () {
  const ns = (window.Explainer = window.Explainer || {});
  const SVG = "http://www.w3.org/2000/svg";
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  };
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(SVG, tag);
    for (const key in attrs || {}) n.setAttribute(key, String(attrs[key]));
    return n;
  };
  const equal = (a, b, tolerance) =>
    Math.abs(Number(a) - Number(b)) <= tolerance;
  const format = (value) =>
    Number.isFinite(Number(value))
      ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })
      : "—";
  const evidenceItem = (item) =>
    item != null && typeof item === "object"
      ? {
          label: String(item.label || item.id || "Untitled input"),
          sourceId: item.sourceId || "",
        }
      : { label: String(item), sourceId: "" };

  ns.createCohortSimulator = function createCohortSimulator(spec) {
    if (!spec || typeof ns.createSim !== "function")
      throw new Error("createCohortSimulator requires a spec and sim.js");
    const mount =
      typeof spec.mount === "string"
        ? document.querySelector(spec.mount)
        : spec.mount;
    if (!mount) throw new Error("createCohortSimulator: mount not found");
    const population = spec.population || {};
    const cohorts = Array.isArray(population.cohorts) ? population.cohorts : [];
    const levers = Array.isArray(spec.levers) ? spec.levers : [];
    if (cohorts.length === 0 || levers.length === 0)
      throw new Error(
        "createCohortSimulator requires population.cohorts and levers",
      );
    const baselineCounts = Object.fromEntries(
      cohorts.map((cohort) => [cohort.id, Number(cohort.count) || 0]),
    );
    const declaredSum = Object.values(baselineCounts).reduce(
      (sum, count) => sum + count,
      0,
    );
    const total =
      population.total == null ? declaredSum : Number(population.total);
    const tolerance = Math.max(0.01, Math.abs(total) * 0.000001);
    const cohortById = Object.fromEntries(
      cohorts.map((cohort) => [cohort.id, cohort]),
    );
    const outcomes =
      Array.isArray(spec.outcomes) && spec.outcomes.length
        ? spec.outcomes
        : [
            {
              id: spec.outcomeId || "cohort-outcome",
              label: spec.outcomeLabel || "People reached",
            },
          ];
    const root = el("section", "ex-cohort-sim");
    root.setAttribute("data-cohort-sim", spec.id || "cohort");
    root.setAttribute("data-population-total", String(total));
    root.setAttribute("data-visual-version", "0");
    if (spec.forecast) root.setAttribute("data-forecast", "true");
    const controls = el("div", "ex-cohort-controls");
    const errors = el("div", "ex-cohort-errors");
    errors.setAttribute("role", "alert");
    errors.hidden = true;
    const frame = el("div", "ex-cohort-frame");
    function panel(title, note) {
      const panelRoot = el("section", "ex-cohort-panel");
      const body = el("div", "ex-cohort-panel-body");
      panelRoot.append(
        el("h3", "ex-cohort-panel-title", title),
        el("p", "ex-cohort-panel-note", note),
        body,
      );
      return { root: panelRoot, body };
    }
    const populationPanel = panel(
      "Population now",
      "One cell represents one per cent of the declared population.",
    );
    const comparePanel = panel(
      "What moved",
      "Bars show the current cohort; the fine marker is the baseline.",
    );
    const uncertaintyPanel = panel(
      "Range, not a promise",
      "The line is the central estimate; the shaded area is the supplied range.",
    );
    uncertaintyPanel.root.classList.add("ex-cohort-panel-wide");
    const waffle = svgEl("svg", {
      viewBox: "0 0 340 340",
      width: "100%",
      role: "img",
      "aria-label": "One hundred cells representing the current cohort",
      "data-visual-version": "0",
    });
    const comparison = el("div", "ex-cohort-compare");
    comparison.setAttribute("role", "img");
    comparison.setAttribute(
      "aria-label",
      "Baseline compared with current cohort counts",
    );
    comparison.setAttribute("data-visual-version", "0");
    const uncertainty = svgEl("svg", {
      viewBox: "0 0 720 260",
      width: "100%",
      role: "img",
      "aria-label": "Outcome estimate with uncertainty range",
      "data-visual-version": "0",
    });
    const legend = el("div", "ex-cohort-legend");
    populationPanel.body.append(waffle, legend);
    comparePanel.body.append(comparison);
    uncertaintyPanel.body.append(uncertainty);
    frame.append(
      populationPanel.root,
      comparePanel.root,
      uncertaintyPanel.root,
    );
    function buildModelCard(card) {
      const details = el("details", "ex-model-card");
      details.setAttribute("data-model-card", "");
      details.open = true;
      const groups = el("div", "ex-model-evidence");
      [
        ["observed", "Observed inputs"],
        ["assumptions", "Assumptions"],
        ["derived", "Derived outputs"],
        ["scenarios", "Scenario choices"],
      ].forEach(([kind, heading]) => {
        const items = Array.isArray(card[kind]) ? card[kind] : [];
        if (!items.length) return;
        const section = el("section", "ex-model-evidence-group");
        section.setAttribute(
          "data-evidence-kind",
          kind === "assumptions" ? "assumed" : kind,
        );
        section.appendChild(el("h4", "", heading));
        const list = el("ul", "");
        items
          .map(evidenceItem)
          .forEach((item) =>
            list.appendChild(
              el(
                "li",
                "",
                item.sourceId ? `${item.label} [${item.sourceId}]` : item.label,
              ),
            ),
          );
        section.appendChild(list);
        groups.appendChild(section);
      });
      details.append(
        el("summary", "", card.title || "How this model works"),
        el(
          "p",
          "ex-model-card-intro",
          card.summary ||
            "Inputs are separated by what is observed, assumed and derived.",
        ),
        groups,
      );
      if (card.limitations) {
        const limits = el("p", "ex-model-limits");
        limits.append(
          el("strong", "", "Limits. "),
          document.createTextNode(String(card.limitations)),
        );
        details.appendChild(limits);
      }
      if (card.uncertaintyExemption) {
        const exemption = el(
          "p",
          "ex-model-exemption",
          card.uncertaintyExemption,
        );
        exemption.setAttribute("data-uncertainty-exemption", "");
        details.appendChild(exemption);
      }
      return details;
    }
    root.append(controls, errors, frame, buildModelCard(spec.modelCard || {}));
    mount.appendChild(root);
    const setupErrors = [];
    if (!Number.isFinite(total) || total <= 0)
      setupErrors.push("Population total must be a positive number.");
    if (!equal(declaredSum, total, tolerance))
      setupErrors.push(
        `Baseline cohorts sum to ${format(declaredSum)}, not the declared population of ${format(total)}.`,
      );
    cohorts.forEach((cohort) => {
      if (!cohort.id) setupErrors.push("Every cohort needs an id.");
      if (!Number.isFinite(Number(cohort.count)) || Number(cohort.count) < 0)
        setupErrors.push(
          `Cohort "${cohort.id || "unknown"}" has an invalid count.`,
        );
    });
    if (spec.leverId && !levers.some((lever) => lever.id === spec.leverId))
      setupErrors.push(
        `No lever has the required chapter-spine id "${spec.leverId}".`,
      );
    if (
      spec.outcomeId &&
      !outcomes.some((outcome) => outcome.id === spec.outcomeId)
    )
      setupErrors.push(
        `No outcome has the required chapter-spine id "${spec.outcomeId}".`,
      );
    function lookupModel(values) {
      const id = spec.policyLever || levers[0].id;
      const key = String(values[id]);
      const policy = spec.policies && spec.policies[key];
      if (!policy)
        throw new Error(`No policy result is declared for ${id}="${key}".`);
      const counts = { ...baselineCounts };
      Object.entries(policy.cohorts || {}).forEach(([cohortId, count]) => {
        counts[cohortId] = count;
      });
      Object.entries(policy.adjustments || {}).forEach(([cohortId, delta]) => {
        counts[cohortId] = Number(counts[cohortId] || 0) + Number(delta);
      });
      return {
        cohorts: counts,
        outcomes: policy.outcomes || {},
        uncertainty: policy.uncertainty,
        trajectory: policy.trajectory,
      };
    }
    function callModel(values) {
      const result = (
        typeof spec.model === "function" ? spec.model : lookupModel
      )({ ...values }, { total, cohorts: { ...baselineCounts } });
      if (result && typeof result.then === "function")
        throw new Error(
          "The cohort model must be synchronous and pure; resolve data before creating the simulator.",
        );
      return result || {};
    }
    function validateRange(range, label, resultErrors) {
      const low = Number(range.low);
      const central = Number(range.central);
      const high = Number(range.high);
      if (
        ![low, central, high].every(Number.isFinite) ||
        low > central ||
        central > high
      )
        resultErrors.push(`${label} must satisfy finite low ≤ central ≤ high.`);
    }
    function normalise(raw) {
      const resultErrors = [];
      const counts = { ...baselineCounts };
      if (Array.isArray(raw.cohorts))
        raw.cohorts.forEach((item) => {
          if (item && item.id) counts[item.id] = item.count;
        });
      else if (raw.cohorts && typeof raw.cohorts === "object")
        Object.entries(raw.cohorts).forEach(([id, count]) => {
          counts[id] = count;
        });
      Object.entries(counts).forEach(([id, count]) => {
        if (!cohortById[id])
          resultErrors.push(`Model returned unknown cohort "${id}".`);
        if (!Number.isFinite(Number(count)) || Number(count) < 0)
          resultErrors.push(`Cohort "${id}" returned an invalid count.`);
        else counts[id] = Number(count);
      });
      const sum = Object.values(counts).reduce(
        (acc, count) => acc + Number(count || 0),
        0,
      );
      if (!equal(sum, total, tolerance))
        resultErrors.push(
          `Current cohorts sum to ${format(sum)}, not ${format(total)}.`,
        );
      const resultOutcomes = { ...(raw.outcomes || {}) };
      outcomes.forEach((outcome) => {
        const value = resultOutcomes[outcome.id];
        if (value == null)
          resultErrors.push(`Model did not return outcome "${outcome.id}".`);
        if (value != null && !Number.isFinite(Number(value)))
          resultErrors.push(`Outcome "${outcome.id}" must be a finite number.`);
        else if (
          outcome.kind === "percent" &&
          (Number(value) < 0 || Number(value) > 100)
        )
          resultErrors.push(
            `Percentage outcome "${outcome.id}" must be between 0 and 100.`,
          );
      });
      const range = raw.uncertainty || null;
      if (range) validateRange(range, "Uncertainty", resultErrors);
      const trajectory = Array.isArray(raw.trajectory) ? raw.trajectory : [];
      trajectory.forEach((point, index) =>
        validateRange(point, `Trajectory point ${index + 1}`, resultErrors),
      );
      if (trajectory.length) root.setAttribute("data-forecast", "true");
      if (
        (spec.forecast || trajectory.length) &&
        !range &&
        !trajectory.length &&
        !(spec.modelCard && spec.modelCard.uncertaintyExemption)
      )
        resultErrors.push(
          "A forecast must provide uncertainty, a trajectory range, or a specific uncertainty exemption.",
        );
      return {
        counts,
        sum,
        outcomes: resultOutcomes,
        uncertainty: range,
        trajectory,
        errors: resultErrors,
      };
    }
    function cellsFor(counts) {
      const shares = cohorts.map((cohort, index) => {
        const exact = total > 0 ? (Number(counts[cohort.id]) / total) * 100 : 0;
        return {
          id: cohort.id,
          index,
          whole: Math.max(0, Math.floor(exact)),
          fraction: exact - Math.floor(exact),
        };
      });
      let allocated = shares.reduce((sum, item) => sum + item.whole, 0);
      [...shares]
        .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
        .forEach((item) => {
          if (allocated < 100) {
            item.whole += 1;
            allocated += 1;
          }
        });
      const cells = [];
      shares.forEach((item) => {
        for (let i = 0; i < item.whole && cells.length < 100; i++)
          cells.push(item.id);
      });
      while (cells.length < 100) cells.push(cohorts[cohorts.length - 1].id);
      return cells;
    }
    function paintWaffle(result) {
      waffle.replaceChildren();
      cellsFor(result.counts).forEach((id, index) =>
        waffle.appendChild(
          svgEl("rect", {
            x: 10 + (index % 10) * 33,
            y: 10 + Math.floor(index / 10) * 33,
            width: 24,
            height: 24,
            rx: 12,
            class: "ex-cohort-cell",
            "data-cohort": id,
            "data-tone": cohortById[id].tone || "neutral",
          }),
        ),
      );
      legend.replaceChildren();
      cohorts.forEach((cohort) => {
        const row = el("div", "ex-cohort-legend-row");
        const mark = el("span", "ex-cohort-legend-mark");
        mark.setAttribute("data-tone", cohort.tone || "neutral");
        const share = total > 0 ? (result.counts[cohort.id] / total) * 100 : 0;
        row.append(
          mark,
          el("span", "ex-cohort-legend-label", cohort.label),
          el(
            "strong",
            "",
            `${format(result.counts[cohort.id])} · ${share.toFixed(1)}%`,
          ),
        );
        legend.appendChild(row);
      });
    }
    function paintComparison(result) {
      comparison.replaceChildren();
      const maximum = Math.max(
        ...Object.values(baselineCounts),
        ...Object.values(result.counts),
        1,
      );
      cohorts.forEach((cohort) => {
        const baseline = baselineCounts[cohort.id];
        const current = result.counts[cohort.id];
        const delta = current - baseline;
        const row = el("div", "ex-cohort-compare-row");
        const head = el("div", "ex-cohort-compare-head");
        head.append(
          el("span", "", cohort.label),
          el(
            "strong",
            "",
            `${format(current)} · ${delta > 0 ? "+" : ""}${format(delta)}`,
          ),
        );
        const track = el("div", "ex-cohort-compare-track");
        const bar = el("span", "ex-cohort-compare-bar");
        bar.setAttribute("data-tone", cohort.tone || "neutral");
        bar.setAttribute("data-cohort", cohort.id);
        bar.style.width = `${Math.max(0, Math.min(100, (current / maximum) * 100))}%`;
        const marker = el("span", "ex-cohort-compare-baseline");
        marker.style.left = `${Math.max(0, Math.min(100, (baseline / maximum) * 100))}%`;
        marker.setAttribute("aria-label", `Baseline ${format(baseline)}`);
        track.append(bar, marker);
        row.append(head, track);
        comparison.appendChild(row);
      });
    }
    function paintUncertainty(result) {
      uncertainty.replaceChildren();
      uncertainty.removeAttribute("data-uncertainty");
      const points = result.trajectory.length
        ? result.trajectory
        : result.uncertainty
          ? [
              {
                x: result.uncertainty.label || "Estimate",
                ...result.uncertainty,
              },
            ]
          : [];
      if (!points.length) {
        const empty = svgEl("text", {
          x: 360,
          y: 130,
          class: "ex-cohort-empty",
          "text-anchor": "middle",
        });
        empty.textContent =
          spec.modelCard && spec.modelCard.uncertaintyExemption
            ? "No range shown — see the declared exemption below."
            : "No uncertainty range supplied.";
        uncertainty.appendChild(empty);
        return;
      }
      uncertainty.setAttribute("data-uncertainty", "");
      const pad = { left: 58, right: 34, top: 28, bottom: 48 };
      const width = 720 - pad.left - pad.right;
      const height = 260 - pad.top - pad.bottom;
      const maximum =
        Math.max(...points.map((point) => Number(point.high)), 1) * 1.08;
      const x = (index) =>
        points.length === 1
          ? pad.left + width / 2
          : pad.left + (index / (points.length - 1)) * width;
      const y = (value) =>
        pad.top + height - (Number(value) / maximum) * height;
      [0, 0.5, 1].forEach((fraction) => {
        const gy = pad.top + height * (1 - fraction);
        uncertainty.appendChild(
          svgEl("line", {
            x1: pad.left,
            x2: pad.left + width,
            y1: gy,
            y2: gy,
            class: "ex-cohort-guide",
          }),
        );
        const label = svgEl("text", {
          x: pad.left - 8,
          y: gy + 4,
          class: "ex-cohort-axis",
          "text-anchor": "end",
        });
        label.textContent = format(maximum * fraction);
        uncertainty.appendChild(label);
      });
      if (points.length === 1)
        uncertainty.append(
          svgEl("line", {
            x1: x(0),
            x2: x(0),
            y1: y(points[0].low),
            y2: y(points[0].high),
            class: "ex-cohort-range",
          }),
          svgEl("circle", {
            cx: x(0),
            cy: y(points[0].central),
            r: 7,
            class: "ex-cohort-point",
          }),
        );
      else {
        const upper = points
          .map(
            (point, index) =>
              `${index ? "L" : "M"} ${x(index)} ${y(point.high)}`,
          )
          .join(" ");
        const lower = [...points]
          .reverse()
          .map((point, reverseIndex) => {
            const index = points.length - 1 - reverseIndex;
            return `L ${x(index)} ${y(point.low)}`;
          })
          .join(" ");
        uncertainty.append(
          svgEl("path", { d: `${upper} ${lower} Z`, class: "ex-cohort-band" }),
          svgEl("path", {
            d: points
              .map(
                (point, index) =>
                  `${index ? "L" : "M"} ${x(index)} ${y(point.central)}`,
              )
              .join(" "),
            class: "ex-cohort-line",
          }),
        );
      }
      points.forEach((point, index) => {
        const label = svgEl("text", {
          x: x(index),
          y: 246,
          class: "ex-cohort-axis",
          "text-anchor": "middle",
        });
        label.textContent = String(point.x ?? point.label ?? index + 1);
        uncertainty.appendChild(label);
      });
    }
    let version = 0;
    function paint(result) {
      paintWaffle(result);
      paintComparison(result);
      paintUncertainty(result);
      const all = [...new Set([...setupErrors, ...result.errors])];
      root.setAttribute("data-model-valid", String(!all.length));
      root.setAttribute("data-cohort-total", String(result.sum));
      errors.hidden = !all.length;
      errors.replaceChildren();
      if (all.length) {
        errors.appendChild(el("strong", "", "Model cannot be trusted yet."));
        const list = el("ul", "");
        all.forEach((message) => list.appendChild(el("li", "", message)));
        errors.appendChild(list);
      }
      version += 1;
      const state = cohorts
        .map((cohort) => `${cohort.id}:${result.counts[cohort.id]}`)
        .join("|");
      [root, waffle, comparison, uncertainty].forEach((visual) => {
        visual.setAttribute("data-visual-version", String(version));
        visual.setAttribute("data-visual-state", state);
      });
      try {
        window.parent.postMessage(
          {
            type: "cohort_changed",
            ts: Date.now(),
            cohorts: result.counts,
            outcomes: result.outcomes,
          },
          "*",
        );
      } catch (error) {
        /* not embedded */
      }
    }
    const baselineValues = {};
    levers.forEach((lever) => {
      baselineValues[lever.id] =
        spec.baselineValues &&
        Object.prototype.hasOwnProperty.call(spec.baselineValues, lever.id)
          ? spec.baselineValues[lever.id]
          : lever.value;
    });
    let baselineRaw;
    try {
      baselineRaw = callModel(baselineValues);
      const second = callModel(baselineValues);
      if (JSON.stringify(baselineRaw) !== JSON.stringify(second)) {
        setupErrors.push(
          "The model returned different results for identical baseline inputs. Remove randomness or use a fixed seed.",
        );
        root.setAttribute("data-deterministic", "false");
      } else root.setAttribute("data-deterministic", "true");
    } catch (error) {
      setupErrors.push(error instanceof Error ? error.message : String(error));
      baselineRaw = { cohorts: baselineCounts, outcomes: {} };
      root.setAttribute("data-deterministic", "false");
    }
    const baselineResult = normalise(baselineRaw);
    setupErrors.push(...baselineResult.errors);
    cohorts.forEach((cohort) => {
      if (
        !equal(
          baselineResult.counts[cohort.id],
          baselineCounts[cohort.id],
          tolerance,
        )
      )
        setupErrors.push(
          `Baseline mode changes cohort "${cohort.id}"; baselineValues must reproduce the declared population exactly.`,
        );
    });
    root.setAttribute(
      "data-baseline-valid",
      String(
        cohorts.every((cohort) =>
          equal(
            baselineResult.counts[cohort.id],
            baselineCounts[cohort.id],
            tolerance,
          ),
        ),
      ),
    );
    if (
      typeof spec.model !== "function" &&
      spec.policies &&
      typeof spec.policies === "object"
    ) {
      const policyLever = spec.policyLever || levers[0].id;
      const baselinePolicy = String(baselineValues[policyLever]);
      Object.keys(spec.policies)
        .filter((key) => key !== baselinePolicy)
        .forEach((key) => {
          try {
            const values = { ...baselineValues, [policyLever]: key };
            const first = callModel(values);
            const second = callModel(values);
            if (JSON.stringify(first) !== JSON.stringify(second)) {
              setupErrors.push(
                `Policy "${key}" returned different results for identical inputs.`,
              );
              root.setAttribute("data-deterministic", "false");
            }
            normalise(first).errors.forEach((message) =>
              setupErrors.push(`Policy "${key}": ${message}`),
            );
          } catch (error) {
            setupErrors.push(
              `Policy "${key}": ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        });
    }
    const sim = ns.createSim({
      mount: controls,
      levers,
      outcomes,
      step(values) {
        let raw;
        try {
          raw = callModel(values);
        } catch (error) {
          const failed = normalise({ cohorts: baselineCounts, outcomes: {} });
          failed.errors.unshift(
            error instanceof Error ? error.message : String(error),
          );
          paint(failed);
          return Object.fromEntries(
            outcomes.map((outcome) => [outcome.id, "model error"]),
          );
        }
        const result = normalise(raw);
        paint(result);
        const output = { ...result.outcomes };
        outcomes.forEach((outcome) => {
          if (output[outcome.id] == null) output[outcome.id] = "model error";
        });
        return output;
      },
    });
    return {
      root,
      set: sim.set,
      recompute: sim.recompute,
      get values() {
        return sim.values;
      },
      destroy() {
        sim.destroy();
        root.remove();
      },
    };
  };
})();
