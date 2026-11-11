# Knitting recent features into JKai and workflows

Date: 2026-11-11. Built autonomously; decisions are logged at the end.

## Problem

Features added to the site since the summer (family alerts, wishlist offers,
places, games, captures, share links, releases, the estate page) are reachable
from their pages but mostly not from JKai chat or from workflows. The canvas
tool picker lists only the tools Workflows holds locally, several nodes call
tools that do not exist, and events raised in one process are never heard in
another.

## What changes, by repository

### SR-Workflows
- The site-tool picker lists Main's live catalogue merged with the local tools.
- `blog` and `blog-ops` nodes call the real `blog_*` tools; `deck-build` is
  repaired if a real tool exists and retired otherwise.
- `blog`, `blog-ops`, `health-query` and `infrastructure-status` pass their node
  context, so their calls stop arriving as `purpose: 'unlabelled'`.
- `workflow_approve` / `workflow_reject` tools; `workflow_add_schedule` refuses
  an unknown trigger type or event type.
- The site-tool node loses `allowDestructive`.
- The dead `chat` node is replaced by `ask_jkai`, which asks Core for one turn.
- The stale capability fixture is replaced.

### SR-Jkai-Core
- A follow-up turn carries the tools of the schedule group that queued it, so a
  light-confirm tool the owner already approved can run unattended.
- The stale capability fixture is replaced and the hand-kept keyword and
  toolset fallbacks that duplicated it are deleted.

### SR-Main
- Events: `family.alert`, `wishlist.offer`, `trip.needs_you`, `share.opened`,
  `capture.ready`, `release.live`, `pull.opened`, `drive.file_added`,
  `game.finished`, `daydream.acted`. Payloads carry names and ids, never
  coordinates. Events with no emitter are wired or dropped.
- Main hears `workflow.completed` raised by the Workflows process by tailing
  `platform_events`, and hands those rows to the delivery listener only. It does
  not re-run the dispatcher, so no workflow starts twice.
- Read tools for places, wishlist offers, family status, games, the notebook,
  releases and pull requests, share links, estate and connectors, the site map,
  the solutions register and web search through the balancer.
- Light-confirm write tools for capture follow-ups, naming and merging places,
  briefing votes, connector resync, the wishlist sweep and one-press daydream
  solutions.
- Event monitors from chat.
- A guard test: every native API family, server domain, notification category
  and catalogue event has a manifest row or a page-only entry with a reason.

## Verification

- Targeted vitest in each repository; the full gate on porkserv for Main and
  each repository's own CI for Core and Workflows.
- Live: the deployed sha, the catalogue endpoint listing the new tools, the
  picker route returning Main tools, and a new event row in `platform_events`.

## Decision log

| Fork | Options | Chosen | Why | Reversible |
|---|---|---|---|---|
| People location in chat | expose / keep held | keep held | location of family members is the most sensitive data here | yes |
| `family.alert` payload | coordinates / place name | place name, owner workflows only | a workflow output can travel anywhere | yes |
| `allowDestructive` on the site-tool node | keep / remove | remove | the principal already refuses it; the switch only misleads | yes |
| Release and PR tools | read+write / read-only | read-only | merge and revert stay a deliberate page action | yes |
| Cross-process events | HTTP push / tail the table | tail the table | the row is already written; no new endpoint or secret | yes |
| Who dispatches | both tail and dispatch / deliveries only | Main tails `workflow.completed` for deliveries only | each process already dispatches its own events; a general re-emit would start runs twice | yes |
| Page-only capabilities | new manifest status / separate list | separate list with reasons | no change to the catalogue contract Core and Workflows read | yes |
| Retiring duplicate native nodes | rewrite now / defer | defer | it changes the behaviour of live production workflows; needs a per-workflow migration | n/a |
| Storage for new state | new tables / datastore collections | no new tables | a new table needs a hand grant in production and can hang CI | yes |
| Order | all at once / receivers first | Workflows and Core merge before Main | the shared-contract rule | n/a |
