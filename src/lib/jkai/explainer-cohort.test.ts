// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import SIM_SRC from "../../../static/explainer-kit/sim.js?raw";
import COHORT_SRC from "../../../static/explainer-kit/cohort.js?raw";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function load(): any {
  document.body.innerHTML = '<div id="mount"></div>';
  new Function(SIM_SRC)();
  new Function(COHORT_SRC)();
  return (window as any).Explainer;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function spec(): any {
  return {
    mount: "#mount",
    id: "eligibility",
    leverId: "policy",
    outcomeId: "reached",
    forecast: true,
    population: {
      total: 100,
      cohorts: [
        { id: "reached", label: "Reached", count: 60, tone: "good" },
        { id: "missed", label: "Missed", count: 20, tone: "bad" },
        { id: "other", label: "Outside", count: 20 },
      ],
    },
    levers: [
      {
        id: "policy",
        label: "Policy",
        kind: "choice",
        options: ["baseline", "automatic"],
        value: "baseline",
      },
    ],
    outcomes: [{ id: "reached", label: "Reached" }],
    policies: {
      baseline: {
        cohorts: { reached: 60, missed: 20, other: 20 },
        outcomes: { reached: 60 },
        uncertainty: { low: 55, central: 60, high: 65 },
      },
      automatic: {
        cohorts: { reached: 75, missed: 5, other: 20 },
        outcomes: { reached: 75 },
        uncertainty: { low: 70, central: 75, high: 80 },
      },
    },
    modelCard: {
      observed: [{ label: "Baseline", sourceId: "FACT-1" }],
      assumptions: ["Reach"],
      derived: ["Reached"],
      limitations: "Teaching model.",
    },
  };
}

describe("createCohortSimulator", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  it("renders a valid, disclosed baseline and updates every visual", () => {
    const ns = load();
    const sim = ns.createCohortSimulator(spec());
    expect(sim.root.getAttribute("data-model-valid")).toBe("true");
    expect(sim.root.getAttribute("data-baseline-valid")).toBe("true");
    expect(sim.root.getAttribute("data-deterministic")).toBe("true");
    expect(document.querySelectorAll(".ex-cohort-cell")).toHaveLength(100);
    expect(
      document.querySelector<HTMLDetailsElement>("[data-model-card]")?.open,
    ).toBe(true);
    const before = sim.root.getAttribute("data-visual-version");
    sim.set("policy", "automatic");
    expect(
      document.querySelector('[data-outcome="reached"]')?.textContent,
    ).toBe("75");
    expect(
      document.querySelectorAll('.ex-cohort-cell[data-cohort="reached"]'),
    ).toHaveLength(75);
    expect(sim.root.getAttribute("data-visual-version")).not.toBe(before);
  });
  it("validates hidden lookup states before the reader operates them", () => {
    const ns = load();
    const broken = spec();
    broken.policies.hidden = {
      cohorts: { reached: 90, missed: 20, other: 20 },
      outcomes: { reached: Number.NaN },
    };
    const sim = ns.createCohortSimulator(broken);
    expect(sim.root.getAttribute("data-model-valid")).toBe("false");
    expect(document.querySelector(".ex-cohort-errors")?.textContent).toMatch(
      /Policy "hidden".*finite number/,
    );
  });
  it("rejects a false baseline and invalid range", () => {
    const ns = load();
    const broken = spec();
    broken.policies.baseline.cohorts = { reached: 61, missed: 19, other: 20 };
    broken.policies.baseline.uncertainty = { low: 70, central: 60, high: 65 };
    const sim = ns.createCohortSimulator(broken);
    expect(sim.root.getAttribute("data-baseline-valid")).toBe("false");
    expect(sim.root.getAttribute("data-model-valid")).toBe("false");
    expect(document.querySelector(".ex-cohort-errors")?.textContent).toMatch(
      /low ≤ central ≤ high/,
    );
  });
  it("requires uncertainty for forecasts", () => {
    const ns = load();
    const broken = spec();
    delete broken.policies.baseline.uncertainty;
    const sim = ns.createCohortSimulator(broken);
    expect(sim.root.getAttribute("data-model-valid")).toBe("false");
    expect(document.querySelector(".ex-cohort-errors")?.textContent).toMatch(
      /forecast must provide uncertainty/,
    );
  });
  it("rejects nondeterministic custom models", () => {
    const ns = load();
    const broken = spec();
    let call = 0;
    broken.policies = undefined;
    broken.model = () => {
      const moved = call++ % 2;
      return {
        cohorts: { reached: 60 + moved, missed: 20 - moved, other: 20 },
        outcomes: { reached: 60 + moved },
        uncertainty: { low: 55, central: 60, high: 65 },
      };
    };
    const sim = ns.createCohortSimulator(broken);
    expect(sim.root.getAttribute("data-deterministic")).toBe("false");
    expect(sim.root.getAttribute("data-model-valid")).toBe("false");
  });
});
