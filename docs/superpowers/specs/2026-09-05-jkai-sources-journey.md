# Sources — a hub surface with a journey that does things

**Date:** 2026-09-05

**Status:** Implemented in this branch. Autonomous run; every gate below was
self-approved and logged.

**Builds on:** `2026-09-04-jkai-activity-fabric.md` (the fabric) and PRs #694,
#697 (the catalogue, the four-step wizard and the connection page).

## Brief

> There was some functionality added on /jkai/sources that allowed connection
> to other personal data feeds from a number of locations. I want the endpoint
> to have a UI, added to the menu, with a good onboarding process that isn't
> just instructions, but takes advantage of the site's dev journeys.

## What was actually there

The pages exist. What made them read as "an endpoint with no UI":

1. **Not in the menu.** Sources and Activity are in the ⌘K launcher but not
   in the hub `menu ▾` (the visible menu, and the phone `more` sheet), and not
   in the `jkai` section of the nav manifest.
2. **Dead in production.** `app_settings` has no `activity.*` rows, so the
   catalogue opens on a `STAGED — the fabric is off` banner, and the Steam key
   is read from `process.env` only — setting it means `chattr -i` on the VPS
   `.env` and a restart. Every card said "Prepare this source →". Zero
   connections; one abandoned onboarding session.
3. **Step 3 was prose.** The Connect step described what would happen and
   listed things to do elsewhere. The real actions (authorize, upload, grant,
   sync) live on the connection page, reached by a second click.
4. **No payoff.** Step 8 exists but nothing on the site could consume the data:
   the `activity` toolset (plan M5.1) was not started, so "ask jkai about my
   games" had no tool to call.

## The journey after this change

Owner opens **menu ▾ → Sources** (or `/jkai/sources`).

1. **Purpose** — unchanged.
2. **Source** — unchanged.
3. **Connect** is now a readiness checklist where each blocked row carries the
   control that unblocks it, all inside the page:
   - *Fabric / provider switch* → one button, `POST
     /api/activity/v1/providers/{id}/enable`, which flips `activity.enabled`
     and `activity.provider.{id}.enabled` (launch gate enforced, same rule as
     `/admin/connections/catalog`).
   - *Application key* (Steam) → a write-only paste box that stores the key in
     the site's own secrets vault (`api_secrets`, handle `steam-web-api`,
     bound to `api.steampowered.com`, query injection `key`, GET only). The
     adapter authenticates through `resolveSecretForUrl`, so no activity code
     ever reads the value. `.env` still wins if present.
   - *Account* → the Steam sign-in itself, one click. Creating the pending
     connection and beginning OpenID are now one action; the callback lands
     on the connection page at step 5.
   - Archive providers keep the export-request tracker (there is genuinely
     nothing to do but wait) and say so; the launch gate is shown honestly.
4. **Select data** — unchanged, then straight into authorization for a live
   provider.
5–7. **Preview / Permissions / Initial sync** — unchanged (connection page).
8. **Payoff** — three live actions: **Ask jkai** (deep link
   `/jkai?q=…&send=1` with the outcome's own prompt, answered by the new
   `activity` toolset), **Open in Activity**, **Set up another source**.

The hub menu gains `Sources` (meta: live count of active sources, or `CONNECT
ACCOUNTS`) and `Activity` under Library. Inside the sources family the header
publishes a page menu — Sources, Activity, Data access, Chat — the way Intel
and Codegraph do. (No separate "Guided setup" row: the header lights rows by
prefix, so it would light beside Sources on every onboarding page.)

## The `activity` toolset (M5.1, minimal)

One lazy toolset, four read-only tools, all owner-principal, all grant-gated
(`consumer = jkai`, `dataClass ∈ {metadata, activity}`, category-less grant):

| Tool | Returns |
| --- | --- |
| `activity_sources` | Every connection with status, freshness, coverage and whether jkai may read it |
| `activity_summary` | Counts by source × category × type over a bounded window, evidence mix, coverage |
| `activity_search` | ≤ 25 event metadata rows matching a label/type substring |
| `activity_get` | One event and its provenance |

Coverage is always present so "no activity" is never confused with "no
readable source": `complete`, `partial` (some connections unreadable),
`snapshot_only`, `stale` (last success > 36h), `unavailable`.

## Files touched

Menu: `src/lib/nav/site-nav.ts`, `HubHeader.svelte`, `jkai/+layout.server.ts`,
`jkai/+layout.svelte`, new `jkai/sources/+layout.svelte`, `tests/lib/nav/site-nav.test.ts`.

Operator setup: new `activity/providers/secrets.server.ts`,
`steam/credential.ts` (+ test), `steam/credential.server.ts`,
`steam/adapter.server.ts`, `catalog.server.ts` (+ test),
`connections/[id]/authorize/+server.ts`, new
`providers/steam/credential/+server.ts`, new `providers/[provider]/enable/+server.ts`,
new `activity/providers/flags.server.ts`, `admin/connections/catalog/+page.server.ts`.

Journey: `activity/onboarding.ts` (+ test), `sources/onboard/+page.svelte`,
`sources/+page.svelte`, `sources/connections/[id]/+page.svelte`.

Toolset: new `activity/policy/coverage.ts` (+ test), new
`activity/policy/consumer-access.server.ts`, new `activity/store/summary.server.ts`,
new `site-tools/tools/activity.ts`, `site-tools/registry.ts`,
`keyword-classifier.ts` (+ test).

Found on the way, fixed here because the journey drives them:

- `activity/sync/queue.server.ts` — a claimed job's timestamps came back as
  strings from the raw driver row, so every NON-retryable failure (policy,
  credential, private profile) threw inside the runner's catch and left the
  job `running` under its lease. A mistyped Steam key would have hit this on
  the first sync. `sync/runner-failure.integration.test.ts` pins it.
- `sources/connections/[id]/+page.server.ts` — a connection whose provider is
  hidden or withdrawn from the public catalogue 500'd; it now renders with a
  non-startable provider so it can be inspected and erased.
- `vite.config.ts` — `.worktrees/**` and `build/**` excluded from the dev
  watcher; watching thirty worktrees exhausted the inotify limit before the
  dev server served a page.

## Decision Log

| Fork | Options | Chosen | Why | Reversible |
| --- | --- | --- | --- | --- |
| What "the site's dev journeys" means | (a) reuse the site's existing machinery — vault, settings, chat deep-link, hub menu; (b) a new tour/walkthrough component | **a** | Every blocker in the shipped flow already has a house mechanism; the wizard just never called them. A tour would be more prose. | Yes |
| Where the Steam key lives | (a) `.env` only (status quo); (b) vault via `resolveSecretForUrl`; (c) `integration_credentials` table | **b** | Vault is the house pattern for keys jkai uses but never reads, and it needs no VPS shell. `.env` still takes precedence. Apple Music stays env-only: JWT signing needs the raw key in-process, and it is `planned` anyway. | Yes |
| Owner check on the key write | (a) `requireOwnerActivityPrincipal` (honours the dev LAN bypass); (b) a real signed-in owner session, like `/api/admin/apis/secrets` | **b** | A vault write is a mutation the precedent deliberately keeps off the bypass path. Costs local testability of that one button; the parse/save logic is unit-tested instead. | Yes |
| Fabric switch inside the journey | (a) leave it on `/admin/connections/catalog`; (b) one-click in step 3 | **b** | The owner is the user. Sending him to an admin page mid-wizard is the "instructions" failure mode. | Yes |
| Collapse connect into one click | keep create→navigate→click; or create→authorize→redirect | **collapse** | The second click added nothing; the callback already lands at step 5. | Yes |
| Build M5.1 now | (a) payoff links to Activity only; (b) minimal grant-gated toolset | **b** | Without it the payoff is hollow and the brief's "good onboarding" ends at a dead end. Scoped to four read-only tools; projections (M5.2) untouched. | Yes |
| Hub menu meta for Sources | static word; or a live count | **live count** | One index-only `count(*)` on a tiny table; the layout already pays for three such aggregates and the number is the nudge. | Yes |
| Archive providers still gated | open upload for inspection anyway; or keep the gate | **keep** | The spec's launch gate is evidence-based; the fixture step needs a real export. The UI now says so plainly instead of implying an action. | Yes |
| `remindAt` delivery | wire into briefing/push; or leave | **leave, log** | Out of the brief; noted as follow-up. | — |
| Flip prod settings myself | write `app_settings` from a shell; or leave the button to the owner | **leave** | Enabling Steam needs his Steam key anyway; the button is the deliverable and it is one click. | — |

## Follow-ups (not in this change)

- Deliver `remindAt` for archive waits through the briefing or push channel.
- M5.2 projections and Daydream signals.
- Apple Music: a vault path would need a store-only credential set read by the
  developer-token module rather than request injection.
