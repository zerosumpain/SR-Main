// story.ts — the words for the overview's scroll story: how one thought becomes a feature.
//
// Same rules as the other copy modules. Words only, no figures (drift.test.ts checks), and
// every line has its engineering twin. The scenes are drawn in components/art/LoopStory.svelte
// and read their figures from facts.

import type { Twin } from './daydream';
import type { PartId } from './nav';

export interface Beat extends Twin {
  id: 'notice' | 'decide' | 'queue' | 'build' | 'pocket';
  part: PartId;
  title: string;
  /** Which chapter tells the whole of this beat. */
  more: { part: PartId; slug: string; label: string };
}

export const STORY: Beat[] = [
  {
    id: 'notice', part: 'daydream', title: 'It notices',
    plain: 'While I get on with my day, it picks one small question about my life, the way you might wonder whether you’ve been sleeping worse lately, and looks at only what that question needs. If it finds something worth knowing, it writes me a note.',
    eng: 'A clock-keyed schedule picks one channel and outcome pair per cycle. The cycle gets a read-only toolset scoped to that pair, and an auditor checks every citation before a note is stored.',
    more: { part: 'daydream', slug: 'questions', label: 'How it picks a question' },
  },
  {
    id: 'decide', part: 'daydream', title: 'I decide',
    plain: 'Nothing happens to a note until I’ve looked at it. I mark it useful, not useful or not for me, and if I’m not sure it’s right I can ask it to argue with itself first.',
    eng: 'Notes wait on an owner verdict or an approval-gated double-check, and nothing downstream runs until one lands. Ruling a note wrong needs a reason, which is stored and fed back as a lesson.',
    more: { part: 'daydream', slug: 'inbox', label: 'A note’s journey' },
  },
  {
    id: 'queue', part: 'build', title: 'Ideas join one queue',
    plain: 'A good idea joins one queue, alongside the things I’ve asked for and fixes for its own mistakes. Overnight, when nobody is using the site, it tidies the queue and starts on the ideas I’ve already agreed to.',
    eng: 'Every source files into one backlog board. A nightly heartbeat run, bounded by budget and work caps, grooms it and turns accepted items into deliveries.',
    more: { part: 'build', slug: 'backlog', label: 'Where ideas come from' },
  },
  {
    id: 'build', part: 'build', title: 'It builds it',
    plain: 'Each idea is built in a private copy of the site. I’m shown it working, every test is marked pass or fail, and it only reaches the real site through the same checks my own changes go through.',
    eng: 'A delivery is a brief, an isolated worktree build under a budget, a candidate revision with a preview and per-criterion verdicts, then a pull request through CI and the risk tier.',
    more: { part: 'build', slug: 'develop', label: 'From brief to live' },
  },
  {
    id: 'pocket', part: 'app', title: 'It reaches my pocket',
    plain: 'And it turns up on my phone and my watch, in the app, on widgets and on the Lock Screen, which is also where the next note lands for me to answer. Then round it goes again.',
    eng: 'A native app and a watch app reach the site through one paired, separately guarded API, and the site pushes notifications and Live Activity updates itself.',
    more: { part: 'app', slug: 'surfaces', label: 'Where it shows up' },
  },
];

/** The overview's other words. */
export const OVERVIEW_COPY = {
  hero: {
    plain: 'Most of this site is an ordinary website. Three parts of it aren’t. While I’m busy it thinks about my life and writes down what it notices, the ideas I like it builds into itself, and all of it lives in my pocket. These pages show how, with every figure read from the code that runs it.',
    eng: 'Three subsystems worth explaining. An idle-cycle reasoning loop over my own data, an autonomous delivery pipeline that changes the site’s code behind a brief, a preview and CI, and a native app that reaches the site through one guarded API. Everything else here is ordinary engineering and isn’t covered.',
  },
  trust: {
    plain: 'The last version of these pages was written by hand, and it went out of date as fast as I changed the site. This one doesn’t copy anything. If a feature changes and nobody updates the words, the site refuses to build rather than let the page lie.',
    eng: 'Facts are imported from the feature modules on the server, so a changed cap or a new stage reaches the page on the next deploy. Copy is keyed by the features’ own union types with satisfies, so a stage added without a sentence fails svelte-check, and a drift test pins what types can’t see, including every route the features serve.',
  },
} as const;
