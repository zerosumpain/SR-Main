// src/lib/workflows/site-tools/tools/studio.ts
//
// Chat entry point for a Studio build — the second of two ways a human starts
// one, alongside the toggle on /jkai/builds/new. Both call the same
// `createStudioBuild` (src/lib/jkai/studio.ts), so a build started from chat
// gets an identical row (origin='studio', planStatus='approved', the deeper
// STUDIO_BUDGET) to one started from the form.
//
// Deliberately NOT destructive, matching `build_create`/`build_tweak` in
// builds.ts rather than `request_change`/`publish_page`: a build (studio or
// not) is a reversible, private action — it can be paused/stopped/deleted and
// nothing ships anywhere until a human hits Publish from the build card. The
// tool-bridge's blanket "no destructive tool reaches a build" rule (see
// tool-bridge.ts) means marking this destructive would also make it invisible
// to every OTHER build's toolset, which is a stronger reason not to: nothing
// in this toolset gates build-creation itself on cost or duration, only on
// externally-visible side effects (publish, send, delete).
//
// `producesLongRunningTask` mirrors `build_create` — a Studio build runs for
// hours, so it gets the same auto-attached heartbeat watcher rather than
// leaving the caller to guess at progress.

import { register } from '../registry-internal';

register({
  name: 'studio_build',
  description:
    'Start a Studio build: turn a challenge statement into a multi-chapter interactive explainer ' +
    'published at /projects/<slug>/. Runs a research stage, plans a chapter spine, then builds one ' +
    'complete chapter per iteration. Use this when the user wants to LEARN a topic, not when they ' +
    'want an app or a change to an existing repo.',
  parameters: {
    type: 'object',
    properties: {
      challenge: {
        type: 'string',
        description:
          'What the reader should understand by the end. A good challenge names a subject and the ' +
          'thing about it that is counter-intuitive, e.g. "Explain how the National Funding Formula ' +
          'decides what a school receives, and why two schools of the same size get different budgets."',
      },
      title: { type: 'string', description: 'Optional title override' },
      researchMode: {
        type: 'string',
        enum: ['reuse', 'extend', 'fresh'],
        description:
          "Where the evidence comes from. 'extend' (default) reuses what prior research already " +
          "established and only researches the gaps. 'reuse' uses existing knowledge ONLY and fails " +
          "if there is not enough — fast and free, good for a topic already covered. 'fresh' ignores " +
          'prior work and always runs a new Deep Dive, which takes 30-90 minutes.',
      },
    },
    required: ['challenge'],
  },
  category: 'JKAI Builder',
  toolset: 'builds',
  producesLongRunningTask: { kind: 'build', idPath: 'buildId', cadenceSeconds: 30 },
  handler: async (args) => {
    const { createStudioBuild } = await import('$lib/jkai/studio');
    const { buildId } = await createStudioBuild({
      challenge: args.challenge as string,
      title: typeof args.title === 'string' ? args.title : undefined,
    });
    return { success: true, data: { buildId, url: `/jkai/builds/${buildId}` } };
  },
});
