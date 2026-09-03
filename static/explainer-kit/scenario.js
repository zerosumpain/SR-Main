/* Explainer kit — operated network/scenario visual. Requires sim.js. */
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
    Object.entries(attrs || {}).forEach(([key, value]) =>
      n.setAttribute(key, String(value)),
    );
    return n;
  };
  ns.createNetworkSimulator = function createNetworkSimulator(spec) {
    if (!spec || typeof ns.createSim !== "function")
      throw new Error("createNetworkSimulator requires a spec and sim.js");
    const mount =
      typeof spec.mount === "string"
        ? document.querySelector(spec.mount)
        : spec.mount;
    if (!mount) throw new Error("createNetworkSimulator: mount not found");
    const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
    const edges = Array.isArray(spec.edges) ? spec.edges : [];
    const lever = spec.lever || {};
    const scenarios = spec.scenarios || {};
    if (nodes.length < 2 || !edges.length || !lever.id)
      throw new Error(
        "createNetworkSimulator requires nodes, edges and lever.id",
      );
    const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
    edges.forEach((edge) => {
      if (!byId[edge.from] || !byId[edge.to])
        throw new Error(`Unknown node in edge "${edge.id}"`);
    });
    const root = el("section", "ex-network-sim");
    root.setAttribute("data-network-sim", spec.id || "network");
    root.setAttribute("data-visual-version", "0");
    const controls = el("div", "ex-network-controls");
    const svg = svgEl("svg", {
      viewBox: spec.viewBox || "0 0 760 400",
      width: "100%",
      role: "img",
      "aria-label": spec.ariaLabel || "Scenario network",
      "data-visual-version": "0",
    });
    root.append(controls, svg);
    mount.appendChild(root);
    const edgeEls = {};
    edges.forEach((edge) => {
      const from = byId[edge.from];
      const to = byId[edge.to];
      const line = svgEl("line", {
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        class: "ex-network-edge",
        "data-edge": edge.id,
      });
      svg.appendChild(line);
      edgeEls[edge.id] = line;
      if (edge.label) {
        const label = svgEl("text", {
          x: (Number(from.x) + Number(to.x)) / 2,
          y: (Number(from.y) + Number(to.y)) / 2 - 8,
          class: "ex-network-edge-label",
          "text-anchor": "middle",
        });
        label.textContent = edge.label;
        svg.appendChild(label);
      }
    });
    const nodeEls = {};
    nodes.forEach((node) => {
      const group = svgEl("g", {
        class: "ex-network-node",
        "data-node": node.id,
        transform: `translate(${node.x} ${node.y})`,
      });
      group.appendChild(svgEl("circle", { r: node.r || 33 }));
      const label = svgEl("text", { y: 4, "text-anchor": "middle" });
      label.textContent = node.label;
      group.appendChild(label);
      svg.appendChild(group);
      nodeEls[node.id] = group;
    });
    let version = 0;
    function paint(scenario, key) {
      const weights = scenario.edges || {};
      const active = new Set(scenario.activeNodes || []);
      edges.forEach((edge) => {
        const raw = Array.isArray(weights)
          ? weights.includes(edge.id)
            ? 1
            : 0
          : Number(
              Object.prototype.hasOwnProperty.call(weights, edge.id)
                ? weights[edge.id]
                : 0,
            );
        const weight = Number.isFinite(raw) ? Math.max(0, raw) : 0;
        edgeEls[edge.id].setAttribute("data-active", String(weight > 0));
        edgeEls[edge.id].setAttribute("data-weight", String(weight));
        edgeEls[edge.id].style.strokeWidth = String(
          1.5 + Math.min(weight, 1) * 8,
        );
        edgeEls[edge.id].style.opacity = String(
          weight > 0 ? 0.35 + Math.min(weight, 1) * 0.65 : 0.12,
        );
        if (weight > 0) {
          active.add(edge.from);
          active.add(edge.to);
        }
      });
      nodes.forEach((node) =>
        nodeEls[node.id].setAttribute(
          "data-active",
          String(active.has(node.id)),
        ),
      );
      version += 1;
      const state = `${key}|${edges.map((edge) => `${edge.id}:${edgeEls[edge.id].getAttribute("data-weight")}`).join("|")}`;
      [root, svg].forEach((visual) => {
        visual.setAttribute("data-visual-version", String(version));
        visual.setAttribute("data-visual-state", state);
      });
    }
    const sim = ns.createSim({
      mount: controls,
      levers: [{ kind: "choice", ...lever }],
      outcomes: spec.outcomes || [],
      step(values) {
        const key = String(values[lever.id]);
        const scenario = scenarios[key];
        if (!scenario) throw new Error(`No scenario for ${lever.id}="${key}"`);
        paint(scenario, key);
        return { ...(scenario.outcomes || {}) };
      },
    });
    return {
      root,
      svg,
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
