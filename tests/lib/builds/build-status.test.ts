import { describe, expect, it } from "vitest";
import {
  bucketLabel,
  bucketOf,
  isBuildOutcome,
  isDelivered,
  outcomeNote,
  type BucketInput,
} from "$lib/builds/build-status";

function b(over: Partial<BucketInput> = {}): BucketInput {
  return {
    status: "completed",
    planStatus: "approved",
    outcome: null,
    ...over,
  };
}

describe("bucketOf", () => {
  it("never files an unrecognised status as a success", () => {
    // The regression this module exists for. The old bucket() ended
    // `return 'completed'`, so every status it did not know about — and
    // `cancelled` is 8 rows in production — counted as a delivery on the
    // page's chips and stat tiles.
    expect(bucketOf(b({ status: "sideways" }))).toBe("unknown");
    expect(bucketOf(b({ status: "" }))).toBe("unknown");
    expect(bucketOf(b({ status: "archived" }))).toBe("unknown");
  });

  it("reads cancelled as stopped, not as completed", () => {
    expect(bucketOf(b({ status: "cancelled" }))).toBe("stopped");
  });

  it("splits the things `completed` is used to mean", () => {
    expect(bucketOf(b({ outcome: "delivered" }))).toBe("delivered");
    expect(bucketOf(b({ outcome: "pr_open" }))).toBe("proposed");
    expect(bucketOf(b({ outcome: "budget_cap" }))).toBe("capped");
    expect(bucketOf(b({ outcome: "stopped_by_user" }))).toBe("stopped");
    expect(bucketOf(b({ outcome: "registered" }))).toBe("registered");
  });

  it("reads a null or unfamiliar outcome as delivered", () => {
    // Conservative on purpose: rows written before the column existed, and
    // rows an operator edited by hand, must not be invented into cap-outs.
    expect(bucketOf(b({ outcome: null }))).toBe("delivered");
    expect(bucketOf(b({ outcome: "something_new" }))).toBe("delivered");
  });

  it("keeps the original precedence, so an unapproved plan outranks completed", () => {
    expect(bucketOf(b({ status: "completed", planStatus: "pending" }))).toBe(
      "awaiting",
    );
    expect(bucketOf(b({ status: "awaiting_plan_approval" }))).toBe("awaiting");
    expect(bucketOf(b({ status: "awaiting_iter_approval" }))).toBe("awaiting");
  });

  it("passes the live statuses through unchanged", () => {
    expect(bucketOf(b({ status: "running" }))).toBe("running");
    expect(bucketOf(b({ status: "queued" }))).toBe("queued");
    expect(bucketOf(b({ status: "paused" }))).toBe("paused");
    expect(bucketOf(b({ status: "failed" }))).toBe("failed");
  });

  it("reads the schema default `pending` as queued rather than as a success", () => {
    // `status` defaults to 'pending', so a row created and never started
    // used to render as completed.
    expect(bucketOf(b({ status: "pending" }))).toBe("queued");
  });

  it("tolerates a missing planStatus", () => {
    expect(bucketOf({ status: "completed" })).toBe("delivered");
  });
});

describe("isDelivered", () => {
  it("is true only for the bucket that means the work was produced", () => {
    expect(isDelivered(b({ outcome: "delivered" }))).toBe(true);
    expect(isDelivered(b({ outcome: "pr_open" }))).toBe(false);
    expect(isDelivered(b({ outcome: "budget_cap" }))).toBe(false);
    expect(isDelivered(b({ status: "cancelled" }))).toBe(false);
    expect(isDelivered(b({ status: "nonsense" }))).toBe(false);
  });
});

describe("isBuildOutcome", () => {
  it("accepts only the written values", () => {
    expect(isBuildOutcome("delivered")).toBe(true);
    expect(isBuildOutcome("pr_open")).toBe(true);
    expect(isBuildOutcome("budget_cap")).toBe(true);
    expect(isBuildOutcome("stopped_by_user")).toBe(true);
    expect(isBuildOutcome("registered")).toBe(true);
    expect(isBuildOutcome("completed")).toBe(false);
    expect(isBuildOutcome(null)).toBe(false);
    expect(isBuildOutcome(undefined)).toBe(false);
  });
});

describe("labels", () => {
  it("names every bucket", () => {
    for (const s of [
      "running",
      "queued",
      "paused",
      "failed",
      "cancelled",
      "completed",
      "zzz",
    ]) {
      expect(bucketLabel(bucketOf(b({ status: s })))).toMatch(/\S/);
    }
  });

  it("explains only the endings that need explaining", () => {
    expect(outcomeNote("delivered")).toBe(null);
    expect(outcomeNote("proposed")).toMatch(/not yet verified/i);
    expect(outcomeNote("running")).toBe(null);
    expect(outcomeNote("capped")).toMatch(/budget/i);
    expect(outcomeNote("registered")).toMatch(/never ran/i);
    expect(outcomeNote("unknown")).toMatch(/Unrecognised/i);
  });
});
