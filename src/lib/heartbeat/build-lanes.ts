// src/lib/heartbeat/build-lanes.ts
//
// The two lanes self-improvement cannot reach for itself.
//
// ── Why they live here and not in $lib/selfimprove ──────────────────────────
//
// `$lib/jkai` already imports `$lib/selfimprove` (four files under
// `jkai/intel`), so a `selfimprove -> jkai` import — the one needed to call
// `createDevelopmentDelivery` — would put a fresh `jkai <-> selfimprove` cycle in
// front of `check-module-boundaries`. `$lib/heartbeat -> $lib/jkai` is an
// existing one-way edge, and `$lib/heartbeat -> $lib/monitors` is a new one
// with nothing coming back. So the lanes are injected into the run from here,
// which is also the shape that lets a test hand it fakes.
//
// The CONTRACT lives in `$lib/selfimprove/types` for the same reason — this
// module implements an interface the engine declares, rather than the engine
// reaching up for an implementation.
//
// ── What a lane is ──────────────────────────────────────────────────────────
//
// Two calls, both fire-and-forget. `startDelivery` creates a `/jkai/develop`
// development delivery from an accepted backlog brief — the same creator as the
// owner's "New feature" form — with autopilot on and release policy
// `pull_request`: the builder sidecar's autopilot grooms it, builds it, runs the
// gate, previews it, reviews it against its criteria and opens a PR. It never
// merges, and `risk-tier` refuses to auto-merge anything touching a protected
// path. `createWatch` turns a description into a scheduled workflow with a
// dedupe step and a notifier.
//
// Neither blocks: creating a delivery writes two rows and returns, which
// matters because the improvement run has 25 minutes and a build has two hours.

import type { BuildLanes } from '$lib/selfimprove/types';

export type { BuildLanes, DeliveryRequest, LaneResult } from '$lib/selfimprove/types';

/**
 * The live lanes.
 *
 * Both are lazily imported so that a process which never runs an improvement
 * — every request that merely renders a page — does not pull the builder
 * client and the workflow generator into memory to do it.
 */
export function liveBuildLanes(): BuildLanes {
  return {
    async startDelivery({ title, outcome, criteria, brief, backlogSlug }) {
      const { createDevelopmentDelivery, findBacklogDelivery } = await import('$lib/jkai/development-create.server');
      // The same idea already in development? Hand it back rather than paying twice.
      const live = await findBacklogDelivery(backlogSlug);
      if (live) return { ref: `delivery:${live.buildId}`, label: `existing delivery ${live.buildId.slice(0, 8)}`, reused: true };
      const { buildId } = await createDevelopmentDelivery({
        title, outcome, criteria, brief, backlogSlug,
        area: 'Platform',
        // A change request opened a PR and stopped; this is the same stop.
        releasePolicy: 'pull_request',
        // The owner's accepted brief (or the autobuild override) was the tap
        // to spend, so the run proceeds without a person, as the change
        // request did — and stops to ask when the brief does not settle a question.
        autopilot: true,
      });
      return { ref: `delivery:${buildId}`, label: `delivery ${buildId.slice(0, 8)}` };
    },

    async createWatch({ description }) {
      const { createMonitor } = await import('$lib/monitors/monitors.server');
      // No cron: the generator reads a cadence out of the description when one
      // is stated, and falls back to every six hours when it is not. Passing a
      // guess here would override an explicit "every morning".
      const marker = await createMonitor(description, undefined);
      return { ref: `monitor:${marker.workflowId}`, label: `watch “${marker.slug}” on ${marker.cron}` };
    },
  };
}
