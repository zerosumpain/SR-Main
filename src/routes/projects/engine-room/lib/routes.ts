// routes.ts — every route the three subjects own, and which page of the study accounts for it.
//
// The copy maps elsewhere are keyed by the features' types, so a new STAGE fails the type
// check. A new CAPABILITY usually doesn't add a stage — it adds a route. "Do it for me"
// arrived as one POST under /api/native/daydream with every stage list unchanged, and the
// study went on describing a daydream that could only suggest. So this ledger is keyed by
// route path instead, and the drift test holds it to the build's own route manifest: a route
// in scope with no entry fails, an entry whose route is gone fails, and an entry pointing at
// a page the study no longer has fails.
//
// Each entry either names the leaf that explains it, with one plain line saying what it's
// for, or is hidden with the reason it stays off a public page. Words only, no figures —
// the explainer-copy rule applies here too. The pages render this list with the methods the
// manifest reports, so what the study shows is what the deployed build actually serves.

import type { PartId } from './nav';

/** Which routes belong to the study's three subjects. Anything matching must be in the ledger. */
export const ROUTE_SCOPE =
  /^\/(jkai\/(daydreams|develop|codegraph|builds?)|api\/daydream|api\/native|api\/platform\/(daydream|backlog)|api\/jkai\/(builds|development|codegraph|backlog|forge))(\/|$)/;

/** Who can reach a route. Shown as a label; none of these are linked from the public study. */
export type Who = 'owner' | 'members' | 'phone' | 'service';

export const WHO_LABEL: Record<Who, string> = {
  owner: 'Owner only',
  members: 'Owner and invited members',
  phone: 'Paired phone',
  service: 'Service to service',
};

export type LeafRef = `${PartId}/${string}`;

export type LedgerEntry = { leaf: LeafRef; who: Who; what: string } | { hidden: string };

const owner = (leaf: LeafRef, what: string): LedgerEntry => ({ leaf, who: 'owner', what });
const members = (leaf: LeafRef, what: string): LedgerEntry => ({ leaf, who: 'members', what });
const phone = (leaf: LeafRef, what: string): LedgerEntry => ({ leaf, who: 'phone', what });
const service = (leaf: LeafRef, what: string): LedgerEntry => ({ leaf, who: 'service', what });

export const ROUTE_LEDGER: Record<string, LedgerEntry> = {
  // ── Daydream ─────────────────────────────────────────────────────────────────────────────
  '/jkai/daydreams': owner('daydream/inbox', 'The Inbox: every note as a decision, with whose move it is'),
  '/jkai/daydreams/impact': members('daydream/impact', 'Whether the notes helped, as totals; members see the totals only'),
  '/jkai/daydreams/watches': owner('daydream/inbox', 'The few things worth interrupting me for'),
  '/jkai/daydreams/briefing': owner('daydream/inbox', 'The morning briefing’s daydream section and where it reads from'),
  '/jkai/daydreams/briefing/[day]': owner('daydream/inbox', 'One morning’s briefing, the page the morning message links to'),
  '/api/daydream/thoughts': owner('daydream/inbox', 'My verdicts and rulings on notes, and the on and off switch'),
  '/api/daydream/feedback': owner('daydream/inbox', 'The one-tap replies on a notification'),
  '/api/daydream/commissions': owner('daydream/inbox', 'Ask for a double-check, approve it, or call it off'),
  '/api/daydream/notes': members('daydream/questions', 'The notebook a cycle may read, and a review run by hand'),
  '/api/daydream/notes/audio': owner('daydream/questions', 'A spoken note, stored and transcribed into the notebook'),
  '/api/daydream/notes/audio/[id]': members('daydream/questions', 'Play back or delete one spoken note'),
  '/api/platform/daydream/briefing': service('daydream/inbox', 'Yesterday’s notes, handed to the workflow that sends the morning briefing'),
  '/api/daydream/observe': { hidden: 'Feeds the household location trail. Location stays off the public study.' },
  '/api/daydream/backfill': { hidden: 'A manual maintenance pull of the location trail, not a feature.' },

  // ── Build ────────────────────────────────────────────────────────────────────────────────
  '/jkai/develop': members('build/develop', 'Every delivery, live and archived, in one portfolio'),
  '/jkai/develop/[id]': owner('build/develop', 'One delivery’s workspace: brief, criteria, preview and release'),
  '/jkai/develop/backlog': owner('build/backlog', 'The backlog board, from proposed to live'),
  '/jkai/develop/improvement': members('build/backlog', 'The nightly run, from ideas in to notes out'),
  '/jkai/develop/doctor': owner('build/backlog', 'The workflow doctor’s findings, read from the workflows service'),
  '/jkai/builds/[id]': owner('build/develop', 'The console for one build: raw files, logs and its controls'),
  '/api/jkai/backlog': owner('build/backlog', 'Owner actions on backlog items and their epics'),
  '/api/platform/backlog/intake': service('build/backlog', 'The backlog’s one door for findings from other services'),
  '/api/jkai/development': members('build/develop', 'List deliveries, or commission a new one from an outcome'),
  '/api/jkai/development/[id]': owner('build/develop', 'Read a delivery, record a verdict on a criterion, or ask for a change'),
  '/api/jkai/development/[id]/context': owner('build/develop', 'The context a delivery is briefed with'),
  '/api/jkai/development/models': owner('build/develop', 'Which models a delivery may be built with'),
  '/api/jkai/builds': owner('build/develop', 'List builds, or start one'),
  '/api/jkai/builds/[id]': owner('build/develop', 'Read a build, change its live settings, or remove it'),
  '/api/jkai/builds/[id]/config': owner('build/verify', 'What a build runs under: its prompt, guardrails and the gates that grade it'),
  '/api/jkai/builds/[id]/plan': owner('build/develop', 'The build’s plan, and edits to it'),
  '/api/jkai/builds/[id]/iter': owner('build/verify', 'Approve or reject an iteration that waits on review'),
  '/api/jkai/builds/[id]/continue': owner('build/develop', 'Carry on a finished build with a further request'),
  '/api/jkai/builds/[id]/pause': owner('build/develop', 'Pause a running build'),
  '/api/jkai/builds/[id]/resume': owner('build/develop', 'Resume a paused build'),
  '/api/jkai/builds/[id]/stop': owner('build/develop', 'Stop a build'),
  '/api/jkai/builds/[id]/restart': owner('build/develop', 'Start a build again from the top'),
  '/api/jkai/builds/[id]/cancel-queue': owner('build/develop', 'Take a build out of the queue before it starts'),
  '/api/jkai/builds/[id]/events': owner('build/develop', 'The build’s event log'),
  '/api/jkai/builds/[id]/logs': owner('build/develop', 'Replay a build’s log from where the reader left off'),
  '/api/jkai/builds/[id]/stream': owner('build/develop', 'The build’s live stream, relayed from the builder'),
  '/api/jkai/builds/[id]/session': owner('build/develop', 'Talk to a running build while it works'),
  '/api/jkai/builds/[id]/sandbox': owner('build/verify', 'Snapshots of the sandbox a build runs in'),
  '/api/jkai/builds/[id]/files': owner('build/develop', 'The files a build has written'),
  '/api/jkai/builds/[id]/files/[...path]': owner('build/develop', 'Read or correct one file a build wrote'),
  '/api/jkai/builds/[id]/publish': owner('build/develop', 'Promote a finished app build to its own project page'),
  '/api/jkai/builds/[id]/unpublish': owner('build/develop', 'Take a promoted build back off the projects page'),
  '/api/jkai/builds/[id]/project-card': owner('build/develop', 'Give a change it built a card on the projects page'),
  '/api/jkai/forge/propose': owner('build/develop', 'Start a build against a separate game repository'),
  '/api/jkai/forge/runs': owner('build/develop', 'The builds run against that repository'),
  '/api/jkai/forge/schedules': owner('build/develop', 'Scheduled builds for that repository'),
  '/api/jkai/forge/schedules/[id]': owner('build/develop', 'Change or remove one schedule'),
  '/jkai/codegraph': owner('build/codegraph', 'The build-history map'),
  '/jkai/codegraph/ask': owner('build/codegraph', 'Run a codegraph query by hand and see exactly what a build would be handed'),
  '/jkai/codegraph/relevance': owner('build/codegraph', 'What would be served to a build, and why'),
  '/jkai/codegraph/review': owner('build/codegraph', 'Review lessons, and retire the wrong ones with a reason'),
  '/jkai/codegraph/serves': owner('build/codegraph', 'The record of what was actually served and used'),
  '/jkai/codegraph/sources': members('build/codegraph', 'Where the graph’s knowledge came from'),
  '/jkai/codegraph/improvement': members('build/codegraph', 'How the graph’s advice is being assessed'),
  '/api/jkai/codegraph/query': service('build/codegraph', 'Run one codegraph query, for a running build or for me'),
  '/api/jkai/codegraph/ingest': service('build/codegraph', 'Receive graph units extracted from past build transcripts'),
  '/api/jkai/codegraph/network': owner('build/codegraph', 'The graph, shaped for drawing'),
  '/api/jkai/codegraph/node/[id]': owner('build/codegraph', 'Everything recorded against one file'),

  // ── The app's doorway ────────────────────────────────────────────────────────────────────
  '/api/native/pair': phone('app/api', 'Swap a one-time code for this phone’s key'),
  '/api/native/me': phone('app/api', 'Is this phone’s key still good, and what may it show'),
  '/api/native/session': phone('app/api', 'Sign this phone out'),
  '/api/native/register': phone('app/api', 'Withdraw a request to join'),
  '/api/native/register/apple': phone('app/api', 'Ask to join with Sign in with Apple'),
  '/api/native/account': phone('app/privacy', 'Delete my account and its data from the phone'),
  '/api/native/push': phone('app/api', 'Register this phone for notifications'),
  '/api/native/notifications': phone('app/api', 'What the phone hasn’t raised yet, and the inbox'),
  '/api/native/notifications/routes': phone('app/api', 'Where each kind of notification goes'),
  '/api/native/today': phone('app/surfaces', 'The first screen, in one request'),
  '/api/native/connections': phone('app/api', 'Which accounts need signing in again'),
  '/api/native/companion-pair': phone('app/privacy', 'Pair the background companion that collects health and location'),
  '/api/native/companion-policy': service('app/privacy', 'What the companion is currently allowed to collect'),
  '/api/native/chat/conversations': phone('app/api', 'The thread list, and its search'),
  '/api/native/chat/conversations/[id]': phone('app/api', 'Rename, pin or remove a thread'),
  '/api/native/chat/conversations/[id]/messages': phone('app/api', 'One thread’s history, a page at a time'),
  '/api/native/chat/conversations/[id]/model': phone('app/api', 'What a thread runs on, and what it may switch to'),
  '/api/native/chat/attachments': phone('app/api', 'Send a photo or a document into chat'),
  '/api/native/chat/attachments/[id]': phone('app/api', 'Show an attachment in the transcript'),
  '/api/native/news': phone('app/api', 'The news desk, sized for a phone'),
  '/api/native/news/actions': phone('app/api', 'Favourite, keep, note or research a story'),
  '/api/native/news/story/[source]/[id]': phone('app/api', 'Read one story'),
  '/api/native/daydream': phone('daydream/inbox', 'Daydream notes on the phone, including the Health tab’s strip'),
  '/api/native/daydream/feedback': phone('daydream/inbox', 'Rate a note, or rule it right or wrong with a reason'),
  '/api/native/daydream/act': phone('daydream/inbox', 'Do it for me: carry out a note’s step, or take it back'),
  '/api/native/daydream/commissions': phone('daydream/inbox', 'Ask for and follow a double-check from the phone'),
  '/api/native/health/hub': phone('app/api', 'Everything the health page concludes, for the phone'),
  '/api/native/health/summary': phone('app/surfaces', 'The health figures the widgets and the watch show'),
  '/api/native/health/activities': phone('app/api', 'Outings, newest first'),
  '/api/native/health/activities/[id]': phone('app/api', 'One outing: route, heart rate, splits and segments'),
  '/api/native/health/recordings': phone('app/api', 'Save a walk recorded on the phone, even after no signal'),
  '/api/native/health/routes': phone('app/api', 'Saved routes, and saving a new one'),
  '/api/native/health/routes/[id]': phone('app/api', 'One route kept on the phone so it can be followed offline'),
  '/api/native/health/routes/plan': phone('app/api', 'Plan a route to a distance and a sport'),
  '/api/native/health/routes/interpret': phone('app/api', 'Turn a sentence into a route plan’s settings'),
  '/api/native/health/routes/discover': phone('app/api', 'Published routes nearby, ready to save'),
  '/api/native/health/segments': phone('app/api', 'The stretches I keep coming back to'),
  '/api/native/health/segments/[id]': phone('app/api', 'One stretch and its best effort'),
  '/api/native/route-session': phone('app/surfaces', 'Track me live: share a walk with the family'),
  '/api/native/route-session/[id]': phone('app/surfaces', 'Follow one shared walk on a map'),
  '/api/native/route-session/[id]/fixes': phone('app/api', 'The walker’s phone sending its position'),
  '/api/native/route-session/[id]/end': phone('app/api', 'End a shared walk and stop its link'),
  '/api/native/route-gifts': phone('app/api', 'Send a route to someone in the family'),
  '/api/native/route-gifts/[id]': phone('app/api', 'Put a received route away'),
  '/api/native/family/forecast': phone('app/api', 'Where each person is likely to be next'),
  '/api/native/family/steps': phone('app/surfaces', 'Today’s family steps board, also on a widget'),
  '/api/native/family/landgrab': phone('app/surfaces', 'Landgrab ground won and lost each week, beside the steps board'),
  '/api/native/family/landgrab/changes': phone('app/api', 'The map of a week’s Landgrab: what changed hands, and the outing that took it'),
  '/api/native/family/tasks': phone('app/surfaces', 'The family task list, also on a widget'),
  '/api/native/family/tasks/[id]': phone('app/api', 'Tick off, confirm or send back a task'),
  '/api/native/family/alarm': phone('app/surfaces', 'Raise the alarm on every other family phone'),
  '/api/native/family/alarm/cancel': phone('app/surfaces', 'Stand an alarm down'),
  '/api/native/family/forecast/feedback': phone('app/api', 'Say a forecast next move is wrong, so it learns'),
  '/api/native/family/messages': phone('app/surfaces', 'msg family: one line pushed to every other family phone'),
  '/api/native/family/messages/[id]/replies': phone('app/api', 'Answer a family message with an emoji or a line'),
  '/api/native/games': phone('app/surfaces', 'The games lobby: who to invite and what I’m in'),
  '/api/native/games/[id]': phone('app/api', 'One game room, and making a move'),
  '/api/native/games/[id]/stream': phone('app/api', 'A game room, live'),
  '/api/native/games/leaderboard': phone('app/api', 'The family’s games boards'),
  '/api/native/review-demo': { hidden: 'Exists only for the App Store’s reviewers, so they never see real family data.' },
};

/** Every ledger entry the study shows, keyed by path. */
export const shownRoutes = () =>
  Object.entries(ROUTE_LEDGER).flatMap(([path, e]) => ('leaf' in e ? [{ path, ...e }] : []));
