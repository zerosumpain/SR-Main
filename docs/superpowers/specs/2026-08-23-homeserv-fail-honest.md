# Option A — make the homeserv dependency fail honestly

**Status:** implementing · **Date:** 2026-08-23 · **Branch:** `feature/homeserv-fail-honest`

## Problem

Production (VPS) dials homeserv for chat, WhatsApp, Home Assistant and scraping. When
homeserv is unreachable, four things go wrong — none of them "the feature is unavailable":

1. **Nothing switches.** `jkai.chat.hermes_enabled` selects the engine, but only a human can
   flip it. A VPS-local engine (`handleWithLoop` / `generalChat`) already ships and works.
2. **Discovery is slow.** An unreachable Tailscale peer costs ~10.5s (undici connect default).
   A *live* host with a dead service refuses in ~0.07s — so this is not a uniform tax, but the
   dark-host case is the one that hurts and it is unbounded in several places.
3. **Two status gates are dead on arrival.** `wa-escalation.ts` and `intel/notify.ts` both gate
   on `getWhatsAppService().getState().status`. In delegated mode that is set **once** by a
   probe at boot (`service.ts:86-97`) and never re-probed. Any VPS restart during an outage —
   a CI deploy counts — pins both channels off permanently, even after homeserv returns.
4. **The composer lies.** `src/routes/jkai/+page.server.ts:103` reads the env var
   `JKAI_HERMES_CANVAS_CHAT`, not the live setting, so the UI can advertise the wrong engine.

## Non-goals (deliberately out of scope)

- **A WhatsApp outbox.** Four production nodes use `dedupe` `recordMode: 'downstream-success'`,
  whose point is that a failed send does *not* mark items seen. Returning `queued: true` inside a
  completed run commits the dedupe record, so an expired row is content both lost and permanently
  deduped. Today it retries. Leave it.
- **Making `home-assistant` throw.** `engine.ts` defaults `onErrorMode` to `stop`, zero of the 22
  HA nodes carry `_onError`, and the graph has two `error` edges. One stale sensor would kill a
  23-node briefing.
- **Aborting the Hermes SSE mid-turn.** `openStream` is a read-only consumer; the turn was
  submitted separately. Aborting orphans an agent that keeps calling tools against production.
- **Relocating anything.** No second Hermes, no WhatsApp move, no `.env` edits.

## Design

### 1. `src/lib/resilience/hermes-reach.ts` (new)

Single-flight, 30s-cached, 2.5s-bounded probe of `${HERMES_PLATFORM_URL}/platforms/jkai/health`.
Modelled on `pingUrl` in `src/lib/architecture/health.ts:10-18` — the one timeout in the tree
that already beats undici's connect default. Fails closed (`false`) on any error.

Two consumers:
- `orchestrator/chat/+server.ts` POST — `useHermes && await isHermesReachable()`, else the loop.
- `orchestrator/chat/+server.ts` PATCH (`deliverToHermes`) — short-circuit with a clear 503
  rather than a ~10s wait and a raw `fetch failed`.

A paused turn belongs to Hermes, so an ack **cannot** fail over to the loop — there is no
loop-side turn to resume. Failing fast with an actionable message is the honest outcome.

### 2. Bound the unbounded fetches

| Site | Was | Now | Why |
|---|---|---|---|
| `hermes-client.ts:210` `sendMessage` | none | 30s | Carries base64 attachments; the reach probe handles the dark-host case in 2.5s, so this is only a hung-socket backstop. |
| `homeassistant/service.ts:34` | none | 10s | LAN call. |
| `scraper/runner.ts:179` | none | 10min | A real scrape takes minutes; node ceiling is 20min. |
| `scraper/interactive-remote.ts:61,87` | none | 30s | Session start/stop return immediately. |
| `hermes-remote.ts:58` `GET_TIMEOUT` | 8000 | 2500 | `/admin/ops/{engine,sessions,cron}` cost 8s each during an outage. |

`hermes-client.ts:13` `streamDispatcher` keeps `bodyTimeout: 0` — its comment explains why (a
delegated turn can be silent for 20 minutes) and the job watchdog already reaps a dead stream.

### 3. Delete the two dead status gates

Replace the `state.status !== 'connected'` early-return in `wa-escalation.ts` and
`intel/notify.ts` with an actual send attempt, reporting the real `{ sent, error }`. The service
already returns a structured result; the gate added nothing but a permanent off-switch.

### 4. Composer honesty

`src/routes/jkai/+page.server.ts:103` reads the live setting **and** reachability, so the UI
names the engine that will actually answer. `conversations/[id]/+server.ts:67` already reads the
live setting — it gains reachability only, so attachment affordances match the real engine.

## Decision Log

| # | Decision | Options considered | Chosen | Why | Reversible |
|---|---|---|---|---|---|
| 1 | Ack path on outage | (a) fail over to loop (b) fast honest 503 | **(b)** | The paused turn lives in Hermes; the loop has nothing to resume. Failing over would silently drop the user's answer. | Yes |
| 2 | `sendMessage` timeout | 10s / 30s / 60s | **30s** | Attachments ride in the body and the reviewer refuted the claimed size cap, so a short timeout risks breaking media. Reach probe already gives 2.5s detection. | Yes, one constant |
| 3 | WhatsApp `sent:false` lie | fix now / defer | **Defer** | WhatsApp is logged out right now, so making it throw would flip 36 workflows from silently-broken to loudly-failing overnight. That is a deliberate call for John, not a side effect of this change. Logged, not forgotten. | n/a |
| 4 | Dead gates | re-probe / delete | **Delete** | The send already returns a structured result. Re-probing adds a second source of truth to keep in sync. | Yes |
| 5 | Cache TTL | 10s / 30s / 60s | **30s** | Bounds worst-case staleness after homeserv returns to 30s while keeping the probe off the hot path. | Yes, one constant |
| 6 | Probe failure mode | fail open / fail closed | **Fail closed** | An unknown Hermes must route to the engine that is definitely alive. Worst case is a working chat with fewer tools. | Yes |

## Verification

- Unit tests for the probe: caching, single-flight, timeout, fail-closed.
- Unit tests for engine selection: enabled+reachable → Hermes; enabled+unreachable → loop.
- `npm run gate` green.
- Live: with Hermes reachable, `/jkai` answers via Hermes. Then prove failover against an
  unreachable URL without touching production `.env`.
