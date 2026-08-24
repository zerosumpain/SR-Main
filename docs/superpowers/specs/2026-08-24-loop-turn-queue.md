# Stage 5 — frame parity, and the one thing that was actually missing

**Status:** shipped · **Date:** 2026-08-24 · Hermes exit plan, S5

## The plan was largely wrong about this stage

It listed four gaps. Three of them do not exist:

| Claimed missing | Reality |
|---|---|
| `thinking` | Already emitted by the loop — `general-chat.ts:977`, via `extractReasoningDelta`. |
| `replace`/`finalize` | `replace_bubble` exists in `JobEvent` and is emitted by the Hermes branch. It exists because *Hermes* revises a bubble in place. The loop streams tokens and appends; there is no revision to represent. Not a gap — an inapplicable frame. |
| `media` | There is no `media` frame in this protocol at all. Generated images surface through `generate_image`'s `tool_result`, like any other tool output. |
| **queue semantics** | **Real, and worse than described.** |

## The real gap

`handleWithLoop` had no queue handling whatsoever. A second message sent while
the first was still answering started a **concurrent turn against the same
conversation**. Both streamed into the same thread and both appended to history —
which is how an answer arrives interleaved with the one before it.

The Hermes branch has queued since the cutover, gated on the gateway's
`busy_input_mode`. Every piece it uses — `getRunningJobIdForConversation`,
`markJobQueued`, `whenJobSettles`, `clearJobQueued` — was already exported and
simply never wired into the other branch.

## Design

- The loop **always** queues. There is no gateway to ask, it is its own executor,
  and two of its turns on one conversation are never wanted.
- The wait happens **inside** the background runner, not before the HTTP
  response, so the client still gets its `jobId` immediately and can render a
  queued turn.
- A `status` frame says why nothing is happening — silence reads as a hang.
- After waking, the runner re-checks `abortController.signal.aborted`, so a user
  who gave up while waiting does not get a turn they cancelled.

## Decision Log

| # | Decision | Options | Chosen | Why | Reversible |
|---|---|---|---|---|---|
| 1 | When to queue | mirror Hermes' `busy_input_mode` gate / always | **Always** | The gate exists to ask a gateway what it wants. There is no gateway here. | Yes |
| 2 | Where to wait | before the response / in the runner | **In the runner** | Waiting before responding would hold the HTTP request open for the length of the previous turn, and the client would have no jobId to show. | Yes |
| 3 | `replace_bubble` on the loop | synthesise one / leave it | **Leave it** | The loop appends tokens; there is nothing to replace. Emitting one would be inventing an event that never happens. | Yes |
| 4 | Cancel while queued | ignore / re-check on wake | **Re-check** | Otherwise a cancelled message runs anyway, minutes later, which is worse than not queueing. | Yes |

## Verification

- 8 store tests: finding the running job per conversation, isolation between
  conversations, the queued marker, `whenJobSettles` not resolving early, the
  already-finished race, an unknown job, cancellation while queued, and a
  cancelled first turn releasing the queued one.
- `gate:check` 0 errors · `gate:test` 615 files / 7194 tests / 0 failures.
