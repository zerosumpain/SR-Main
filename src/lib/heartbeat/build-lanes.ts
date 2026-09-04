// src/lib/heartbeat/build-lanes.ts
//
// The two lanes self-improvement cannot reach for itself.
//
// ── Why they live here and not in $lib/selfimprove ──────────────────────────
//
// `$lib/jkai` already imports `$lib/selfimprove` (four files under
// `jkai/intel`), so a `selfimprove -> jkai` import — the one needed to call
// `createChangeRequest` — would put a fresh `jkai <-> selfimprove` cycle in
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
// Two calls, both fire-and-forget. `changeRequest` opens a GitHub issue and
// starts a repo build that branches from master, runs `npm run gate` on every
// iteration, and opens a PR — it never merges, and `risk-tier` refuses to
// auto-merge anything touching a protected path. `createWatch` turns a
// description into a scheduled workflow with a dedupe step and a notifier.
//
// Neither blocks: `createChangeRequest` returns as soon as the build is
// started, which matters because the improvement run has 25 minutes and a
// change-request build has two hours.

import { errMsg, type BuildLanes } from '$lib/selfimprove/types';

export type { BuildLanes, LaneResult } from '$lib/selfimprove/types';

/**
 * The live lanes.
 *
 * Both are lazily imported so that a process which never runs an improvement
 * — every request that merely renders a page — does not pull the builder
 * client and the workflow generator into memory to do it.
 */
export function liveBuildLanes(): BuildLanes {
  return {
    async changeRequest({ title, request }) {
      const { createChangeRequest } = await import('$lib/jkai/change-request');
      const res = await createChangeRequest({
        title: title.slice(0, 120),
        // The ask verbatim, so the issue records what was actually wanted
        // rather than a paraphrase of it — the same reason `createChangeRequest`
        // preserves the requester's words.
        request,
        labels: ['self-improvement'],
      });
      return {
        ref: `build:${res.buildId}`,
        label: `issue #${res.issueNumber} → build ${res.buildId.slice(0, 8)}`,
      };
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

/** A lane set with the change-request half removed, for when GitHub is not
 *  configured. Kept as a function so the reason is written down once. */
export function lanesWithoutGithub(lanes: BuildLanes): BuildLanes {
  const { changeRequest: _unused, ...rest } = lanes;
  void _unused;
  return rest;
}

/** Wrap a lane so a failure is a recorded outcome rather than a thrown phase. */
export async function tryLane<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}
