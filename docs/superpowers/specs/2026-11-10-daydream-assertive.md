# Daydream: assertive and action oriented

Date: 2026-11-10. Status: built, release 1 of the proposal.

## Why

Over the 30 days to 2026-11-10 the think loop wrote 295 notes. 113 were pushed,
13 were answered, 168 expired unread. The notes offered 72 one-press steps and 5
were pressed. Every action waited for a tap that did not come, and a note spoke
once and then aged out.

The owner asked for the process to be "more assertive and action oriented" and
chose, from the proposal:

1. Do-then-tell for steps that can be taken back, with lights turned off in an
   empty house turned back on when people come home.
2. Keep four pushes a day, spent only on notes that carry an action, and on
   chases.
3. Build the open-loops ledger, the autonomy ladder, reply-to-act and the
   prompt and scoring changes as one release, and move every daydream
   notification to the iPhone app and off WhatsApp.

## What was built

### Autonomy ladder (`src/lib/daydream/act/autonomy*.ts`, `standing.server.ts`)

Three tiers.

- **do**: carried out when the note is written, then told with an Undo. Lights
  off in an empty house, a reminder, a tracker, an email draft.
- **ask**: one tap, as before. Switches, anything in the diary, a build, a page
  to open, a watch.
- **never**: sending, paying, booking, cancelling, locks, heating. No kind
  exists for them.

Two automatic acts of a kind undone inside 30 days put that kind back to ask.
Three taps on it there move it forward again. The owner can set either by hand
on Solutions, and a kind he set to ask is never moved forward by the ladder.
Six automatic acts a day across all kinds.

Lights go off automatically only when every household member is known to be
out. A stale fix or a member who is not sharing counts as possibly home. `household-live` turns them back on when anyone is home, within
24 hours. That restore is recorded and is not counted as an undo.

### Open loops (`src/lib/daydream/act/loops*.ts`)

A note that reached him with a step waiting and got no answer is chased once:
on its last day or the day before if it is dated, after two days if not, never
after seven. At most two chases a day, out of the same four-a-day allowance. The
chase leads with the step and offers the way out.

A note with nothing to press and no `Next:` step no longer pushes. It goes to
the feed, and a Sunday-evening digest names the week's.

### Prompt and delivery (`src/lib/daydream/think/run.ts`)

The prompt now asks for the step first and tells the model what jkai carries
out by itself. Delivery sorts notes with a press first, acts before it pushes,
and titles an acted note `Done: …`.

### Notifications

Every daydream raise passes `channels: { whatsapp: false }`, the catalogue
default for the `daydream` category is iPhone only, and reminders a note sets
arrive on the phone only (`phoneOnly` on `notify_owner`).

### Surfaces

Solutions gains "What jkai does by itself": each kind with its level and a
switch, what always stays a tap and why, and recent automatic acts. The note
card says "Done for you". `POST /api/daydream/thoughts` gains `set_autonomy`.

## Decision log

| Fork | Chosen | Why | Reversible |
|---|---|---|---|
| Where ladder, away-lights and chase state live | Three `app_settings` keys, read direct under an advisory lock | A new table needs a hand GRANT in production and can hang CI; `getSetting` caches per process and heartbeat and web are separate processes | Yes |
| Diary holds and switches under do-then-tell | Left as one tap | The tool contract refuses calendar writes and switches to an unattended caller. Weakening it for this release would widen what every unattended run can reach | Yes, as a contract change of its own |
| When lights go off by themselves | Only when every member is known out | A stale fix or a non-sharing member may be someone under the light. Found in review: the first draft needed only one person out | Yes |
| Watches under do-then-tell | Left as one tap | Found in review: a watch becomes a scheduled workflow generated from the note's words, which can come from mail or the web, and no tool contract bounds it | Yes, once watch creation has a constrained mode |
| An automatic act whose push fails | Logged and counted in the heartbeat summary; the note still shows "Done for you" with Undo | A retry risks a double push | Yes |
| Lights back on | When anyone is home, within 24 h, no push, not an undo | The owner's condition; a return is not a correction | Yes |
| Do automatic acts spend the four pushes | They are sent even over the cap, and count towards it | An act he was not told about is worse than a fifth push | Yes |
| Does an automatic act rate the note useful | No | Only his own press is his judgement | Yes |
| Notes with no step | Feed only, plus a weekly digest | Decision 2: pushes are for actions | Yes |
| Chase state | In settings, not on the note | Keeps the register and the card unchanged | Yes |
| Stored WhatsApp route for `daydream` in production | Left; each raise overrides it | The override is in code and cannot drift; the row is cosmetic | Yes |
| Morning briefing on WhatsApp | Left alone | It is the briefing, not a daydream notification | Yes |
| Reply-to-act | iPhone notification actions, as a follow-on in SR-AppleApp | Off WhatsApp there is no reply channel; the push already carries `thoughtId`, `auto` and `chase` | n/a |
| `think` as a never-autobuild source | Not changed | Coupled to the Engine Room drift test and public copy; builds stay a tap anyway | Yes |

## Not in this release

Proposal items 3, 4, 6, 7 and 9, and the iPhone notification actions.
