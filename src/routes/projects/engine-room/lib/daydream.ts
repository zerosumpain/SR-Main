// daydream.ts — the words for the Daydream pages. Words only: every name, count and cap
// arrives from the feature through `facts.server.ts`.
//
// Each map is keyed by the feature's own type and checked with `satisfies`, so when the
// feature grows a stage or drops one, svelte-check fails here until there's a sentence for
// it. The imports are type-only, so none of the feature's server code reaches the browser.

import type { Stage } from '$lib/daydream/think/explain';
import type { CommissionState } from '$lib/daydream/commissioning';
import type { ActKind } from '$lib/daydream/act/plan';
import type { FollowKind } from '$lib/daydream/act/follow';
import type { RedTeamVerdict } from '$lib/daydream/red-team';
import type { SolveKind } from '$lib/daydream/act/solution';
import type { Reason } from '$lib/daydream/reasons';
import type { ShelfBasis } from '$lib/daydream/think/shelf';

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

/** Whose turn each stage is, for the travelling note on the Inbox page. */
export const STAGE_TURN = {
  spotted: { who: 'it', plain: 'Its move. It has written the note and shown its sources.', eng: 'System-owned. The note is stored with audited citations and no verdict.' },
  decide: { who: 'me', plain: 'My move. Nothing else happens until I answer.', eng: 'Owner-owned. Blocks on a verdict or an approved double-check.' },
  motion: { who: 'it', plain: 'Its move again. It checks the sources or queues the idea to be built.', eng: 'System-owned. A commission runs, or a build idea waits in the backlog for a slot.' },
  result: { who: 'me', plain: 'Back to me. I say whether it helped, and that’s the score.', eng: 'Owner-owned. The outcome verdict is stored and counted by the impact page.' },
} satisfies Record<Stage, Twin & { who: 'me' | 'it' }>;

/** The short promise each kind of "Do it for me" step makes, shown as a badge. */
export const ACT_BADGE = {
  calendar_event: 'one tap, can be undone',
  reminder: 'one tap, can be undone',
  calendar_move: 'one tap, can be undone',
  email_draft: 'stops at a draft',
  event_hold: 'one tap, can be undone',
  calendar_batch: 'one tap, can be undone',
} satisfies Record<ActKind, string>;

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
  event_hold: {
    plain: 'Holds the day of something it found for me to go to, and reminds me to book a few days before. Undo removes both.',
    eng: 'One tap. Creates the event on the note’s own date plus a scheduled reminder whose day is computed by code, never by the model. If the reminder fails the event is removed again.',
  },
  calendar_batch: {
    plain: 'Puts a plan’s sessions in my diary, up to a week of them, all or none. Undo removes the lot.',
    eng: 'One tap. Two to seven events, every date named in the note. A failure part-way deletes what was written; Undo deletes each by UID.',
  },
} satisfies Record<ActKind, Twin>;

/** Taking a note further: each follow-up, in both registers. The cost line
 *  shown beside it comes from the feature itself (`FOLLOW_COST`). */
export const FOLLOW_COPY = {
  research: {
    plain: 'Starts a short research run on the note, seeded with the pages it read.',
    eng: 'One tap. Inserts a brief-depth research session with the note’s web sources as seed URLs and starts the worker after the commit.',
  },
  promote: {
    plain: 'Puts a suggestion I backed on the build backlog. It waits there until I accept it.',
    eng: 'One tap, offered only once the note is rated useful or a double-check says it holds. Goes through the single intake door with a thought citation.',
  },
  build: {
    plain: 'Drafts the build brief so I can read it, and my tap on the brief is the acceptance. It builds overnight, one a night.',
    eng: 'Guided. The backlog’s own groomer drafts and checks the brief; saving it stamps acceptedAt, which is what the nightly builder picks up.',
  },
  prototype: {
    plain: 'Builds a one-page sketch in the sandbox so I can see if an idea is worth a real build.',
    eng: 'Guided. A sandbox build under its own token and time ceiling, shown in the cost line; refused when the subscription window is nearly used.',
  },
  watch: {
    plain: 'Instead of building something, it watches for the thing and tells me when it happens. Stop removes it.',
    eng: 'One tap after I word it. Generates a scheduled monitor workflow from my description; Stop deletes the workflow.',
  },
  message: {
    plain: 'Drafts a message for me to send myself, opened in WhatsApp or Mail. It never sends one for me.',
    eng: 'Signpost. One small model call for the text; any number or address comes from a cited source’s text, found by code. A Gmail draft stops for a second tap.',
  },
  home: {
    plain: 'Shows which of my devices have dropped out and asks Home Assistant to refresh the ones I pick.',
    eng: 'Guided. Reads unavailable entities, then calls only update_entity and reload_config_entry on the ones chosen. Nothing is switched or unlocked.',
  },
} satisfies Record<FollowKind, Twin>;

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

/** One-press solutions: what each kind does, and the line it may not cross. */
export const SOLVE_COPY = {
  track: {
    plain: 'Starts a tracker on one thing my devices already measure, with a daily target and an end day. It checks every day and tells me once how it went.',
    eng: 'One press. A tracker on one measured series, with a goal, a target, a start and an end day, stored in app settings. The think activity checks progress each cycle and reports the result once. Stop ends it.',
  },
  home: {
    plain: 'Turns off lights or switches the note itself names. Only off, only lights and switches, never a lock, the alarm or the heating. Undo turns them back on.',
    eng: 'One press. Calls turn_off on light and switch entities named in the note’s cited cards, up to a fixed limit. Every other domain fails the check. Undo calls turn_on on the same entities.',
  },
  open: {
    plain: 'Opens the page that already does it: one of the site’s own pages, or a link the note actually read, like an unsubscribe page.',
    eng: 'A link press. The path must be a page the capability manifest lists, or a URL that appears in a cited card. Nothing the model makes up can pass.',
  },
  build: {
    plain: 'When the site can’t do it yet, one press puts it on the build list, already agreed, so it’s built overnight.',
    eng: 'One press. Files the gap through the backlog intake, drafts the brief and stamps it accepted, which is what the nightly builder picks up.',
  },
  watch: {
    plain: 'Sets up a standing watch, in the note’s own words, that tells me when the thing happens.',
    eng: 'One press. Creates a monitor workflow briefed with the note’s text, the same machinery as Take it further. Stop deletes it.',
  },
} satisfies Record<SolveKind, Twin>;

/** The "Why?" chips after a verdict: what each tells it. */
export const REASON_COPY = {
  already_knew: {
    plain: 'Counts as a no for the note, and tells it what isn’t news to me, so it stops telling me.',
    eng: 'Sets not useful. The title rides in the think prompt’s taste block as something the owner already knows.',
  },
  not_my_thing: {
    plain: 'A no, and a taste: fewer notes like this one.',
    eng: 'Sets not useful. Feeds the taste block, so later cycles weigh the kind down.',
  },
  not_now: {
    plain: 'Not a no. The note is put away with no verdict, so a bad day doesn’t teach it the wrong lesson.',
    eng: 'Files the note as expired and clears any verdict, so the kind’s learned weight doesn’t move.',
  },
  did_it: {
    plain: 'A yes, and I acted on it. Do it for me and a solution say this for me when they finish.',
    eng: 'Sets useful. Written automatically when a one-tap step or a solution completes.',
  },
} satisfies Record<Reason, Twin>;

/** Where a note's "probably past its date" day comes from, in the order it is tried. */
export const SHELF_COPY = {
  stated: {
    plain: 'The note said itself how long it would matter, or I pressed Still relevant.',
    eng: 'relevant_until: the think loop’s own until estimate, or the owner’s keep, which pushes it out.',
  },
  date: {
    plain: 'Otherwise, the last date it names that was still ahead when it was written.',
    eng: 'The latest future date found in the title or narrative. A date already past when written is data it read, not its subject.',
  },
  age: {
    plain: 'Otherwise, a few days after it was written.',
    eng: 'Fallback: a fixed shelf life from the day it was written, in London time.',
  },
} satisfies Record<ShelfBasis, Twin>;

/** What the "Right now" card puts in front of every private thought. Copy only: the card's
 *  rows are built by code in think/situation.server.ts, and none of their values leave it. */
export const SITUATION_ROWS: readonly Twin[] = [
  { plain: 'Where I am, by name: home, away, or a named place. Never a map position.', eng: 'A named place or home, with a distance band. Coordinates never enter the card.' },
  { plain: 'Whether I’m on a trip, and where.', eng: 'The current trip from the trip planner, if today falls inside it.' },
  { plain: 'Who in the family is with me.', eng: 'Household members at the same named place, or both at home, on fresh fixes only.' },
  { plain: 'How I slept, how recovered I am, and my heart-rate variability against my usual.', eng: 'Last night’s sleep, today’s recovery and HRV against baseline, from the health read.' },
  { plain: 'My mood lately.', eng: 'The latest State of Mind valence, with this week’s mean against the week before.' },
  { plain: 'What’s in my diary today and tomorrow.', eng: 'The diary tool’s render of today and tomorrow. Unreadable is said as unknown, not empty.' },
];

export const DAYDREAM_COPY = {
  hub: {
    strap: 'It thinks about my life while I’m busy',
    headline: ['It thinks', 'while I’m', 'busy'],
    lede: 'When nobody is using the site, it picks one small question about my life, looks at only what that question needs, and writes me a note if it finds something worth knowing. Most notes aren’t worth much, and that’s fine, because I’m the one who decides.',
  },
  live: {
    plain: 'Every note it writes is counted here, and most fall away at each step, which is the point. The loop is judged on the few that reach the bottom, not on how much it writes.',
    eng: 'The impact funnel over the rolling window: notes delivered, rated, rated useful, acted on and resolved. Counts only, computed by the feature’s own impact loader.',
  },
  questions: {
    line: { plain: 'It doesn’t browse everything at once. Each cycle asks one narrow question, and a clock decides which.', eng: 'One channel × outcome pair per cycle, chosen by a clock-keyed schedule, with a read-only toolset scoped to that pair.' },
    why: { plain: 'Rotating what it looked at over the same pile of data mostly produced echoes. A narrow question fetches only what it needs, so every part of my life gets the same share of attention.', eng: 'The schedule is clock-derived, so there’s no cursor to drift and two machines agree on the current slot. Each channel gets the same number of visits per period, and pairs that make no sense are excluded by a skip table the tests pin.' },
    situation: {
      plain: 'Before a private thought starts, code writes it a card about my day as a whole, and any suggestion that ignores the card counts as wrong. That came from a trip: abroad with the family, it suggested an easy run at home pace because my recovery looked good.',
      eng: 'A situation card is seeded into every private cycle before the model reads anything, and it is citable like any other card. Standing prompt rules say a suggestion that ignores it is wrong and ask for the interaction between factors, not one signal. Location is context only: no note may be about where I am.',
    },
    capabilities: {
      plain: 'It is also told what the site can already do and what is already on the build list, so it stops suggesting I build something I have.',
      eng: 'The prompt carries the live and preview rows of the capability manifest and the open backlog titles, passed in by the think activity because daydream may not import the backlog.',
    },
    correlate: {
      plain: 'When it wonders whether two things in my life move together, it runs the numbers rather than guessing, and keeps a ledger, so the same pair isn’t tested again until there is enough new data to change the answer.',
      eng: 'correlate runs a Spearman test over day series and can hold a third series fixed (a partial correlation); compare_days runs a Mann–Whitney test between two groups of days. Every test is written to a ledger; a pair with no new data comes back already tested, and a note resting on it is refused. A periodic summary note is written over the ledger.',
    },
    interests: {
      plain: 'A web thought follows one of my interests at a time, chosen by code. An interest rests after a visit, and rests longer after I’ve said no twice. If nothing is due, it doesn’t think at all.',
      eng: 'Interests come from my notebook and research sessions, minus anything daydream started itself, with near-duplicates merged. Code picks one per cycle with a cooldown, longer after two declines, and skips the cycle without a model call when none is due. A research note must carry an action.',
    },
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
    solve: {
      plain: 'A note is meant to end in a solution, not a thought. When it can, it offers one press that makes the site do the thing, and pressing it counts as my yes. Everything it carried out goes on a register, so I can see what came of it.',
      eng: 'The model proposes at most one solution, stored as a solve entry in the note’s proposed actions. Code checks it against the note’s own cited cards before it is offered. Pressing it carries the step out and marks the note useful. The Solutions room lists every solution, step and follow-up carried out, with trackers’ live progress.',
    },
    reasons: {
      plain: 'After I say yes or no, it asks why with a row of one-tap chips. The reason matters more than the verdict: already knew, not my thing and not now are three very different noes.',
      eng: 'A reason is stored in the feedback note column the verdict writer already fills, so no schema change. The no reasons feed a taste block in the think prompt; a research cycle sees only research titles. It is wrong is not a chip: it opens the ruling form instead.',
    },
    subjects: {
      plain: 'Every note is about something, and it remembers what. If it finds the same thing again with nothing new to say, it doesn’t write a second note; the first one just says it was seen again. If something did change, the new note says what, and replaces the old one.',
      eng: 'Each note gets a subject key checked by code. A repeat with no new figure folds into the earlier note as seen again, even if that note has expired. A revision must name a new figure its own cards hold, opens with What changed, and archives older unanswered notes on the subject.',
    },
    plan: {
      plain: 'Health plans are one living plan for the week, pinned at the top, rather than a new plan every few hours.',
      eng: 'Every health plan shares one subject, so it is revised in place, no more often than a minimum interval, and pinned above the Inbox and at the head of the phone’s Today notes while fresh.',
    },
    shelf: {
      plain: 'A note I haven’t answered gets flagged Probably past its date once the day it mattered has gone. I can file it, keep it a while longer, or file them all. If I leave it flagged, it files itself after a grace period.',
      eng: 'Only a note still at Spotted can be flagged: nothing rated, ruled, acted on, checked or followed up. Filing sets it expired, which is not a verdict, so learned weights don’t move. The server re-reads which notes are flagged before filing. A heartbeat sweep files what has stayed flagged past its grace period.',
    },
    chat: {
      plain: 'I can also talk about the notes with JKai in chat. It can find a note, rate it, correct it in my words, and get a double-check ready, but carrying a step out always needs a confirm card, and approving a double-check stays on the Inbox.',
      eng: 'An owner-only daydream toolset on the chat tool registry: inbox and note reads, rate, correct and prepare a double-check as light mutates, and do it for me behind an always-confirm card. Results are labelled derived, nothing is written to personal memory, and the tools are refused for any other principal.',
    },
    check: { plain: 'If I’m not sure a note is right, I can ask for a double-check. It re-reads its sources and argues against its own note before reporting back.', eng: 'A commission is an approval-gated re-run against the cited evidence, with its own state machine. It never runs without an owner approval.' },
  },
  impact: {
    line: { plain: 'The only score that counts is whether I found a note useful. Here’s that score, live.', eng: 'Rated-useful over rated, across a rolling window, plus the funnel from spotted to acted on. Counts only — no note text leaves the server.' },
    caps: { plain: 'It’s kept on a short lead. A few notes a day at most, a handful of tool calls per thought, and only in waking hours.', eng: 'Per-cycle rounds and tool-call caps, a per-cycle note cap enforced by the auditor, a daily raise cap, and an active-hours window on the heartbeat.' },
  },
} as const;
