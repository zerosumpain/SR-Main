// daydream.ts — the words for the Daydream pages. Words only: every name, count and cap
// arrives from the feature through `facts.server.ts`.
//
// Each map is keyed by the feature's own type and checked with `satisfies`, so when the
// feature grows a stage or drops one, svelte-check fails here until there's a sentence for
// it. The imports are type-only, so none of the feature's server code reaches the browser.

import type { Stage } from '$lib/daydream/think/explain';
import type { CommissionState } from '$lib/daydream/commissioning';

export interface Twin {
  /** Plain English — the default register. */
  plain: string;
  /** The same point for someone who wants the mechanism. */
  eng: string;
}

/** The engineering twin of each stage. The plain line is the feature's own STAGE_EXPLAIN. */
export const STAGE_ENG = {
  spotted: 'A think cycle writes a note with its citations. Code audits every citation before the note is stored, and the note sits on the Inbox with no verdict yet.',
  decide: 'The note waits on my verdict (useful, not useful, not for me) or on a double-check I asked for. Nothing downstream runs until one of those lands.',
  motion: 'An approved double-check is queued as a commission and re-reads the cited sources, or a build idea sits in the backlog as an accepted brief waiting for a delivery slot.',
  result: 'The commission completes with a report, or the delivery ships. My verdict on the outcome is stored against the note and is what the impact page counts.',
} satisfies Record<Stage, string>;

/** What each double-check state means, in both registers. */
export const COMMISSION_COPY = {
  awaiting_approval: { plain: 'It wants to check something again and is asking me first.', eng: 'A commission was proposed from a note and needs owner approval before it may spend.' },
  deferred: { plain: 'I said not now. It stays parked until I pick it up.', eng: 'Owner-deferred. Excluded from the run queue until reopened.' },
  declined: { plain: 'I said no. That answer is kept so it doesn’t ask again.', eng: 'Owner-declined. Terminal, and kept as negative evidence for the note.' },
  queued: { plain: 'Approved and waiting its turn.', eng: 'Approved and queued for the commission runner.' },
  running: { plain: 'It’s re-reading the sources right now.', eng: 'The runner holds it and is re-fetching the cited evidence.' },
  needs_attention: { plain: 'Something went wrong and it needs me to look.', eng: 'The run failed or hit a decision it may not make alone. Back to the owner.' },
  completed: { plain: 'The report is ready to read.', eng: 'Terminal success. The report is attached to the note.' },
  cancelled: { plain: 'Stopped before it finished.', eng: 'Terminal. Cancelled by the owner or superseded.' },
} satisfies Record<CommissionState, Twin>;

export const DAYDREAM_COPY = {
  hub: {
    strap: 'What it thinks about while I’m not looking',
    lede: 'On spare cycles it picks one question about my life, reads only what that question needs, and writes down at most a couple of things worth my attention. I decide what they’re worth.',
  },
  questions: {
    line: { plain: 'It doesn’t browse everything at once. Each cycle asks one narrow question, and a clock decides which.', eng: 'One channel × outcome pair per cycle, chosen by a clock-keyed schedule, with a read-only toolset scoped to that pair.' },
    why: { plain: 'Rotating what it looked at over the same pile of data mostly produced echoes. A narrow question fetches only what it needs, so every part of my life gets the same share of attention.', eng: 'The schedule is clock-derived, so there’s no cursor to drift and two machines agree on the current slot. Each channel gets the same number of visits per period, and pairs that make no sense are excluded by a skip table the tests pin.' },
    privacy: { plain: 'A cycle can read my private data or the open web, never both in the same cycle. That’s how a web search can’t carry anything of mine out with it.', eng: 'Private cycles get local and site tools only. Research cycles get web search and fetch only, so they hold no owner data, which is why only a research cycle may produce the research outcome.' },
  },
  inbox: {
    line: { plain: 'Every note goes through the same four stages, and the page always says whose move it is.', eng: 'One stage model shared by the web Inbox, the phone and the sign-off, derived from the note’s verdict, commission state and linked build.' },
    check: { plain: 'If I’m not sure a note is right, I can ask for a double-check. It re-reads its sources and argues against its own note before reporting back.', eng: 'A commission is an approval-gated re-run against the cited evidence, with its own state machine. It never runs without an owner approval.' },
  },
  impact: {
    line: { plain: 'The only score that counts is whether I found a note useful. Here’s that score, live.', eng: 'Rated-useful over rated, across a rolling window, plus the funnel from spotted to acted on. Counts only — no note text leaves the server.' },
    caps: { plain: 'It’s kept on a short lead. A few notes a day at most, a handful of tool calls per thought, and only in waking hours.', eng: 'Per-cycle rounds and tool-call caps, a per-cycle note cap enforced by the auditor, a daily raise cap, and an active-hours window on the heartbeat.' },
  },
} as const;
