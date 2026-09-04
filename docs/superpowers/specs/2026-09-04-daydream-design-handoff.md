# Daydream — applying the design handoff

Source: `design_handoff_daydream` (14 designs — directions `1a`–`1d`, rooms `2a`–`2j`),
uploaded to Drive 2026-09-04. Authored against `master`, so most of it describes code that
already exists: the handoff's own screen map names the files it was drawn from.

## What the survey found

The designer read the shipped rooms and drew from them. Checking each design against the
code rather than against a memory of it turned a "build fourteen screens" brief into a
short list of genuine deltas.

Already shipped, no work needed:

| Design | Evidence it already ships |
| --- | --- |
| `1a` The ledger | `CategoryMatrix` already renders every cell as a `?f=&s=` link with zero cells muted and inert; the feed's section-B row is already `mark / main / chips / acts` with the tone left-border, the band/kind/recurrence/memory chips and the `Open` cta. |
| `2a` Memory | rollup + theme cards + the `in the pack` pill are present. |
| `2b` Briefing | message-as-sent block is already `--code-bg` with `pre-wrap` / `overflow-wrap:anywhere`. |
| `2c` Watches | condition composer + watch rows present. |
| `2d` Family | unknown-position-is-not-at-home already handled. |
| `2e` Discoveries | p-value table + All/Held up/Empty filter present. |
| `2h` Money | "coming up" and "offers" strips present. |
| `2i` Engine | outcome words + 30-day coverage row present. |

## The work

1. **`1c` — the overnight** (`improvement/+page.svelte`). Section C already *is* the
   seven-stage loop rollup, with the design's own heading copy. Missing: the **night
   timeline** (six activity cells: time, name, `duration · result · cost`, the expensive
   pass tinted, caption with finish/budget/kill switch) and **the doctor band** (ink,
   three `border-left:3px` strips). Both come from `heartbeatPulses`
   (`ts, outcome, summary, costUsd, details`) — real data, no stand-ins.
2. **`1d` — the thread** (`feed/+page.svelte`). New: musings plotted by score against the
   threshold, height = distance above/below the bar, a mark opens the evidence chain.
   Added as a second **view** (`Rows | Plot`) rather than a replacement — see the Decision
   Log. Real data: every row already carries `score`, `createdAt` and the threshold.
3. **`2j` — the board** (`QueueBoard.svelte`). Present: stages, cards, flag precedence,
   drag-and-drop, selection bar, `Show N more`. Missing: **ink column headers**;
   the **`Accept` / `Park` button row** the handoff explicitly asks for alongside drag
   ("the mock uses buttons only; implement both"); **`P▲`** as the actionable label
   (plain `P2` in `--text-ghost` when not actionable); **`shipped` + em-dash** in place of
   the controls on `live`/`verifying`; and the **read-only history** strip on the open card.
4. **`2f` — calendar**. Reframe the existing exclude control as the design's positive
   toggle: `◉ may reason` / `○ held out`, Unicode as typography, not icons.
5. **`2g` — places**. Naming-session copy to the design's `Yes, that's it` / `No` /
   `Not worth naming`; the one-tap accept behaviour already exists.

## Not built

**`1b` — "Dreaming now"** is the one design not applied. It renders a *live* ponder pass —
trail being read, cards held, score climbing against a falling bar. The handoff says
"in production this is not a timer: it is the live ponder-pass state. Poll or stream it."
There is no such stream: `ponder/run.ts` runs to completion inside a heartbeat activity and
leaves a pulse row behind, with no per-clause progress published anywhere a page could read.
Building the screen anyway would mean animating invented numbers, against the handoff's own
first caveat ("wire every number to its real loader"). Left out deliberately; the enabling
work is a progress channel on the ponder pass, not a page.

## Decision Log

| Fork | Options | Chosen | Why | Reversibility |
| --- | --- | --- | --- | --- |
| The handoff says "pick one" of `1a`–`1d` | (a) build one and drop three; (b) build all four as competing feeds; (c) keep `1a`, and treat the ones that target other routes as additive | (c) | The four are only alternatives where they compete for the same surface. `1c` targets `improvement/`, a different route — it is a room design, not a rival feed. `1a` already ships and stays the feed's default. | High |
| Where `1d` goes | (a) replace the feed's rows; (b) a second view on the feed; (c) its own route | (b) `Rows \| Plot` toggle | Keeps `1a` as what opens, makes the novel metaphor reachable, and costs one toggle to remove. A new route would need its own rail tab for a view of the same rows. | High — delete the toggle, the feed is unchanged |
| `1b` with no live source | (a) animate a timer like the mock; (b) render the last completed pass and call it live; (c) leave it out and say why | (c) | (a) fabricates data the handoff explicitly forbids; (b) mislabels a historical row as live, which is the same lie with a slower clock. | n/a |
| Column caps / empty stages on `2j` | keep the shipped `empty stages` toggle vs the mock's always-six | keep shipped | The mock shows six columns because it has one card each; the handoff text says empty stages are folded away in the real board unless asked for. Shipped already matches the *text*. | n/a |

## Verification

- `npm run gate` on porkserv (`./scripts/gate-remote.sh --build`), whole suite.
- Local: each touched room screenshotted at 1440×3600 (tall viewport — `fullPage`
  captures only the viewport inside `/jkai`'s `100dvh` shell).
- Live: after CI deploys, `curl` each touched route for a string the change introduces.
