// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import SIM_SRC from "../../../static/explainer-kit/sim.js?raw";
import SCENARIO_SRC from "../../../static/explainer-kit/scenario.js?raw";

describe("createNetworkSimulator", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="mount"></div>';
    new Function(SIM_SRC)();
    new Function(SCENARIO_SRC)();
  });
  it("moves the outcome and semantic visual state together", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sim = (window as any).Explainer.createNetworkSimulator({
      mount: "#mount",
      lever: {
        id: "route",
        label: "Route",
        options: ["direct", "brokered"],
        value: "direct",
      },
      outcomes: [{ id: "hops", label: "Hops" }],
      nodes: [
        { id: "a", label: "A", x: 60, y: 100 },
        { id: "b", label: "B", x: 220, y: 50 },
        { id: "c", label: "C", x: 380, y: 100 },
      ],
      edges: [
        { id: "direct", from: "a", to: "c" },
        { id: "in", from: "a", to: "b" },
        { id: "out", from: "b", to: "c" },
      ],
      scenarios: {
        direct: { edges: { direct: 1 }, outcomes: { hops: 1 } },
        brokered: { edges: { in: 1, out: 1 }, outcomes: { hops: 2 } },
      },
    });
    const before = sim.root.getAttribute("data-visual-state");
    sim.set("route", "brokered");
    expect(document.querySelector('[data-outcome="hops"]')?.textContent).toBe(
      "2",
    );
    expect(sim.root.getAttribute("data-visual-state")).not.toBe(before);
    expect(
      document
        .querySelector('[data-edge="direct"]')
        ?.getAttribute("data-active"),
    ).toBe("false");
    expect(
      document.querySelector('[data-edge="in"]')?.getAttribute("data-active"),
    ).toBe("true");
  });
});
