// daydream.ts — the words for the Daydream pages. Words only: every name, count and cap
// arrives from the feature through `facts.server.ts`.
//
// Each map is keyed by the feature's own type and checked with `satisfies`, so when the
// feature grows a stage or drops one, svelte-check fails here until there's a sentence for
// it. The imports are type-only, so none of the feature's server code reaches the browser.

import type { Stage } from '$lib/daydream/think/explain';
import type { CommissionState } from '$lib/daydream/commissioning';
import type { ActKind } from '$lib/daydream/act/plan';
import type { RedTeamVerdict } from '$lib/daydream/red-team';

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

/** "Do it for me": each kind of step a note can carry out, and why it's allowed. */
export const ACT_COPY = {
  calendar_event: {
    plain: 'Puts an entry in my own diary. Undo deletes it.',
    eng: 'One tap. Creates an event on the owner’s calendar from the note’s own date. Undo deletes the event.',
  },
  reminder: {
    plain: 'Sends me a reminder at a time the note named. Undo cancels it until it goes off.',
    eng: 'One tap. Schedules a message to the owner. Undo cancels the scheduled callback up until it fires.',
  },
  calendar_move: {
    plain: 'Moves one of my diary entries, but only one nobody else is invited to. Undo puts it back.',
    eng: 'One tap. Moves an owner-only event the note names. Events with other attendees are refused. Undo restores the original slot.',
  },
  email_draft: {
    plain: 'Writes a reply but stops at a draft, because it would reach another person. I read it and send it with a second tap.',
    eng: 'Guided. Drafts a reply on the note’s source thread. The recipient is looked up by code from the evidence, never written by the model. Sending is a second tap and can’t be undone.',
  },
} satisfies Record<ActKind, Twin>;

/** The double-check's three answers when it argues against its own note. */
export const VERDICT_COPY = {
  holds: {
    plain: 'It tried to prove itself wrong and couldn’t. For money, that only counts if it actually saw the bank line.',
    eng: 'Survived the red team. A money claim is downgraded to unclear unless a bank or PayPal ledger line was in front of the checker.',
  },
  wrong: {
    plain: 'It found the mistake. The reason becomes a lesson so the next cycle thinks twice.',
    eng: 'Refuted. The narrative is stored as a ruling memory and fed back into later cycles as a lesson.',
  },
  unclear: {
    plain: 'It couldn’t tell either way, so it says so rather than guess.',
    eng: 'Neither proven nor refuted. Anything the parser doesn’t recognise also lands here, never on holds.',
  },
} satisfies Record<RedTeamVerdict, Twin>;

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
    act: {
      plain: 'When a note suggests a step, I can tap Do it for me and it carries the step out. The tap is my yes, so it only does things that stay with me and can be taken back. Anything that reaches someone else stops at a draft.',
      eng: 'A model drafts a plan from the note, and code checks every date, entry and recipient against the note’s own words before anything is written. A plan that fails a check is refused with the reason. Payments, bookings, cancellations and deletions are not on the list.',
    },
    ruling: {
      plain: 'I can also rule on a note myself. Saying it’s wrong needs a reason, and that reason is remembered, so the same mistake is less likely next time.',
      eng: 'An owner ruling goes through the same writer as the double-check. A wrong ruling requires a why, which is stored as a ruling memory; re-ruling supersedes the earlier memory rather than leaving two that disagree.',
    },
    check: { plain: 'If I’m not sure a note is right, I can ask for a double-check. It re-reads its sources and argues against its own note before reporting back.', eng: 'A commission is an approval-gated re-run against the cited evidence, with its own state machine. It never runs without an owner approval.' },
  },
  impact: {
    line: { plain: 'The only score that counts is whether I found a note useful. Here’s that score, live.', eng: 'Rated-useful over rated, across a rolling window, plus the funnel from spotted to acted on. Counts only — no note text leaves the server.' },
    caps: { plain: 'It’s kept on a short lead. A few notes a day at most, a handful of tool calls per thought, and only in waking hours.', eng: 'Per-cycle rounds and tool-call caps, a per-cycle note cap enforced by the auditor, a daily raise cap, and an active-hours window on the heartbeat.' },
  },
} as const;
