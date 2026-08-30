# Daydream absorbs self-improve

**Date:** 2026-08-30
**Status:** agreed; M0 shipped
**Artifact:** https://claude.ai/code/artifact/bc295c18-e442-4e74-9128-963b3a94ec16

Two idle-cycle engines run on this site. One thinks about what it knows and has
an appetite that grows. The other builds new capability every night and hands it
to nobody. Fold the second into the first, and point what it builds at the thing
that is starving.

## The measurement (production, 30 Aug 2026)

| Measure | Value | Reading |
|---|---|---|
| Tools shipped in 14 days | 33 | **0 ever called** |
| Tools live, all time | 69 | 28 have ever been called |
| Lifetime tool calls | 741 | 623 are `reverse_geocode`, from April, erroring 69% of the time |
| Open backlog items | 324 | was 148 on 16 Aug — intake still outruns throughput |
| Daydream thoughts, 4 days | 79 | producing: health, money, plans, family, mail |
| Registered signals | 268 | 5 sources; `registerSignals()` has no self-improve caller |

Self-improve is not idle any more — the night of 30 Aug shipped four tools, kept
a policy overlay worth −6% on calls-per-turn, and opened two draft PRs, for
about a tenth of a penny. The engine works. What it makes goes nowhere.

Mining John's questions, it has independently converged on daydream's exact
domains. The tools it shipped this fortnight and never called include
`home_temperature_evidence_history`, `family_location_history_timeline`,
`personal_context_digest`, `recurring_outgoings_evidence`,
`sleep_data_provenance` and `local_activity_booking_context` — HA sensors,
family trails, money, health, places. Daydream holds all six of those domains
and would use every one of those tools. It cannot see that they exist.

The only code linking the two ran the wrong way: three daydream activities
import `isUserActive` from `$lib/selfimprove/run`. Self-improve was lending
daydream its idle gate and getting nothing back.

## Decisions

**D1 — Full absorb.** Self-improve's private croner dies; the schedule becomes a
heartbeat activity. The heartbeat is the better scheduler: per-activity cadence,
active-hours windows that reschedule to the next opening instead of locking out,
quota attribution per pulse, a failure budget, and a dashboard that already
lists twenty-odd other jobs.

**D2 — Code-driven gap-fill, not a model tool loop.** "Full access to all site
functions" is right in the read direction and needs care in the how.
`compose.ts` states the current guarantee plainly: the model "has no tools and
no database access of its own, so it cannot widen its own context, and a claim
about anything absent from this block is by construction invented." A tool loop
trades that structural guarantee for a runtime audit. Instead *code* decides
what to fetch: `gatherPackInputs()` gains a lookup stage, `assemblePack()` stays
pure, every card stays code-built, and cite-or-die keeps working.

**Correction to this decision as first written (2026-08-30, during M2).** It
said the allow-list would be "any tool not flagged `destructive`", on the basis
that this leaves ~174 of 196 tools available. That framing was wrong and is not
what shipped. The `destructive` flag marks 21 of 188 registered tools and it is
not a read/write split: `ha_call_service`, `workflow_run`, `build_create`,
`blog_create`, `datastore_save`, `save_memory` and `schedule_*` all write and
none of them carry it. `executeTool` applies no gate of its own on headless
paths either. So the lookup stage uses a **positive allow-list of named
probes**, and adds a second rule the original decision missed entirely:
**nothing that returns text somebody else wrote** — no `fetch_url`, no
`research_web_search`, no `mail_read`. A lookup result becomes prompt context,
so a probe over an attacker-controlled page is a prompt injection with a card id
attached. Every shipped probe reads first-party derived state.

**D3 — Starvation drives the toolsmith.** The build driver stops being "232
questions, 5 unmet needs" and becomes what daydream could not answer: citations
the audit dropped, leads that died barren, hypotheses with no testable series,
signals stuck below `MIN_PAIRS`. Question-mining stays on as a secondary source.

**D4 — Cap intake and re-sort.** The cap goes inside `addIdeas()` rather than at
the call sites, because there are four of those and one is easy to forget.
`pickWork` stops letting `attempts` ASC dominate, which has been quietly killing
the retry budget and the `lastError` feedback that `backlog.ts` exists for.

## Phases

- **M0** — absorb the scheduler *(shipped)*
- **M1** — cap intake, fix the sort *(shipped)*
- **M2** — gap-fill the pack *(shipped)*
- **M3** — the starvation ledger
- **M4** — close the loop: a shipped tool registers signals *(shipped)*
- **M5** — one dashboard *(shipped, reshaped — see DL-10)*

## What deliberately does not merge

The engines share a scheduler, a ledger and a dashboard. They do not share a
safety model, and the reason is that they were given different ones on purpose.

- **Two authoring models stay separate.** A *tool* is JavaScript compiled as a
  bare `AsyncFunction` in full Node scope, held only by `verify.ts`'s deny-list
  scan and an all-must-pass smoke test. A *rule* is a closed expression tree
  over an allow-list of 24 scalar facts, walked by an interpreter — no eval, no
  dynamic property access, scalars only so a rule can never hold an object and
  reach a coordinate. A shipped tool must never become reachable from a rule's
  fact set. Widening `FACT_KEYS` is a security decision, not a refactor.
- **The action vocabulary stays `remind`.** Reading widely is the win; acting
  widely is a separate decision. Each action kind is a capability grant.
- **Nothing auto-activates that can buzz a phone.** Tools auto-enable because a
  tool is inert until called. Rules do not, because a rule fires a notification.
- **The composer stays sealed.** Gap-fill goes to the pack builder;
  `compose.ts` gets no tools.
- **`executeTool` gates nothing on headless paths.** The destructive confirmer
  lives in `mcp/jsonrpc.ts` only. Heartbeat, briefing, scheduled, routing,
  workflow nodes and this engine all run past it. The allow-list must be
  enforced by the caller.

## Success

Today: 33 tools shipped in 14 days, 0 ever called. The merge has worked when a
tool the engine wrote for a gap it found itself is being called by the thing
that found the gap, and when the backlog stops growing faster than anything can
drain it.

## Decision Log

**DL-1 — M0 shape: one activity, not four.**
Options: (a) four activities mirroring the phase groups, per the original spec;
(b) one activity wrapping `runImprovementNow` unchanged.
**Chosen: (b).** The eight phases share a budget, a run record and a wall-clock
slot; `maxWallMs` of 25 minutes is the gap between the start and the 04:00
model-routing job, and every phase already self-limits against `timeLeftMs()`.
Four rows would fragment the `improvement_runs` record that `narrative.ts`,
`/jkai/improvement` and `/admin/ai/improvement` all read, for no gain — the goal
of D1 is one *scheduler*, not a re-cut of the phases.
*Reversible:* yes; each phase function is already independently callable, so
splitting later is pure addition.

**DL-2 — `isUserActive` stays in `$lib/selfimprove/run.ts`.**
Options: (a) move to `$lib/daydream/idle.ts` per the spec; (b) move to a neutral
`$lib/server/`; (c) leave it.
**Chosen: (c).** It has three independent consumers — three daydream
activities, `workflowdoctor/engine.ts`, and self-improve itself — so "daydream"
is not its home either. `$lib/selfimprove/` survives the merge as a library;
only its scheduler dies, so the import path stays accurate. Moving it is churn
across six files and four test mocks for no behavioural gain.
*Reversible:* trivially.

**DL-3 — Window 02:30–03:55 Europe/London, cadence daily.**
Options: (a) keep 03:30 as a point; (b) a window.
**Chosen: (b).** The heartbeat needs a window, not an instant. Opening at 02:30
keeps the 25-minute run clear of the 04:00 model-routing slot with an hour to
spare, and closing at 03:55 means a late start can never begin a run that would
collide. The active-hours lockout that silently killed `daydream-bank` and
`daydream-weekly` is already fixed in `schedule.ts` — a window skip reschedules
to the next opening, not to `now + cadence`.
*Reversible:* the row is editable from the heartbeat admin UI.

**DL-7 — Tool signals are DISCOVERED, not flagged at ship time.**
Options: (a) the toolsmith marks a tool as a signal source when it ships;
(b) discovery samples the live registry.
**Chosen: (b).** `verify.ts` runs the smoke test but `CaseOutcome` keeps only
ok/error/ms, not the data — so reading a shipped tool's shape there means
editing the one file that is the entire security boundary between LLM-authored
text and the environment. Discovery touches none of it and adopts the **67
tools that already exist**, not just those shipped from today. Only tools
declaring no required parameters are sampled (22 of 67): a signal is read every
day forever, and code cannot invent arguments — guessing is how a tool ends up
called with the wrong input daily and recording a series about nothing.
*Reversible:* one config flag on the activity.

**DL-8 — No `consecutive_failures` column.**
A tool that fails its first call never gets a signal row, so there is nothing to
count against it; it is retried, which costs one failed call a day out of at
most 25 and is named on the pulse. What needs muting is a tool that registered a
signal and then went dark, and `observedDays` + `firstSeenAt` already say that.
A schema change for a counter that answers a question the existing columns
answer would be debt, not safety.
*Reversible:* yes.

**DL-6 — The schedule accessor lives in `heartbeat/`, not `selfimprove/`.**
First written as `$lib/selfimprove/schedule.ts`, which closed a
`heartbeat <-> selfimprove` cycle: the activity imports `runImprovementNow`, so
anything pointing back the other way makes the two modules inseparable.
`check-module-boundaries` failed CI on it — that pair is not in the baseline and
the baseline may only shrink, so the fix is the move, not an exemption. It reads
a heartbeat row and a heartbeat handler's defaults, so `heartbeat/` was always
its right home. **Worth knowing: `gate-remote.sh` runs svelte-check, vitest and
the build, but NOT the five lint gates** — a clean local gate does not mean the
boundary linter passed.

**DL-4 — The dashboards read the live row, not a constant.**
`CRON_EXPR` + a hardcoded `'03:30 Europe/London'` was printed on two pages as
the live schedule; after the move it would have been a confident lie, and a
dashboard's schedule is the first place anybody looks when they think a job has
stopped. `./schedule.ts` reads the heartbeat row and falls back to the handler's
declared defaults only for a database that has not been seeded yet. The
constants are deleted rather than kept as documentation.
*Reversible:* yes.

**DL-5 — Gates carried over verbatim.**
The host gate (prod-only, `SELF_IMPROVE_ALLOW_DEV=1` override), the kill switch
(`selfimprove.enabled`, unset means on) and the 60-minute idle gate all moved
across unchanged. Not added: daydream's "jobs in flight" spare-cycle gate. The
croner did not have it, and changing what stops a nightly run is a behavioural
decision that does not belong in a scheduler move.
*Reversible:* one config field on the activity.
