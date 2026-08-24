# Stage 6 (part 1) — the two blockers to moving WhatsApp off homeserv

**Status:** shipped (foundation) · **Date:** 2026-08-24 · Hermes exit plan, S6

## Scope, and what is deliberately NOT here

S6 moves WhatsApp off homeserv. Its final step is a **QR scan on John's phone**:
Baileys pairs one device, the session cannot be duplicated, and running two
instances logs one out. That is a human action, and doing it wrong takes WhatsApp
down for 36 workflows with only his phone able to fix it.

So this ships the two code blockers, which are inert until a process is actually
given the new role. The cutover is handed over, not attempted.

## Blocker 1 — one flag for every service

    const RUN_PLATFORM_SERVICES = process.env.JKAI_BUILDER_PROCESS !== '1';

answers one question — "am I the builder?" — and gates five things: the WhatsApp
socket, Home Assistant, prompt sync, custom tools, memory review, the scheduler
and the stale-run reaper. A process wanting the WhatsApp socket and nothing else
had no way to say so; it would also have started the scheduler, and **two
schedulers on one database fires every cron twice**.

Now a role (`$lib/workflows/service-role`):

| Role | Runs |
|---|---|
| `web` (default) | everything — unchanged behaviour |
| `builder` | nothing |
| `whatsapp` | the WhatsApp socket only |

`JKAI_BUILDER_PROCESS=1` still resolves to `builder`: it is set in systemd units
on two hosts, and breaking it would hand the builder a second scheduler silently.

## Blocker 2 — the delegation switch read itself

    private bridgeUrl = process.env.WHATSAPP_HERMES_BRIDGE_URL ?? null;
    private get delegated() { return this.bridgeUrl !== null; }

A WhatsApp worker deployed beside the web app reads the **same EnvironmentFile**.
It would see a bridge URL, conclude it should forward its sends, and forward them
to itself. Delegation now also requires *not* owning the session.

## Decision Log

| # | Decision | Options | Chosen | Why | Reversible |
|---|---|---|---|---|---|
| 1 | Flag shape | more booleans / a role | **Role** | Five services and three process types is a matrix; booleans multiply and drift. | Yes |
| 2 | Legacy flag | drop / keep | **Keep** | Set in units on two hosts. Dropping it gives the builder a scheduler, silently. | Yes |
| 3 | Unknown role value | fail loud / fall back to web | **Fall back to web** | A typo must not disable the scheduler on the only process that runs it. Logged and tested. | Yes |
| 4 | Self-delegation guard | env var / derive from role | **Derive from role** | A second env var is a second thing to get wrong; the role already states the fact. | Yes |
| 5 | The cutover | attempt it / hand over | **Hand over** | Needs a QR scan on John's phone. A failed attempt takes WhatsApp down for 36 workflows and only he can restore it. | n/a |

## The cutover, when wanted

1. Build a `packages/jkai-wa-worker` sidecar whose unit sets
   `JKAI_SERVICE_ROLE=whatsapp`, and add one line to `ci-stage-sidecars.sh`'s
   manifest — S0 made that the whole deployment story.
2. Stop the Hermes WhatsApp bridge on homeserv, so nothing competes for the pair.
3. Start the worker, scan the QR, confirm inbound and outbound.
4. Remove `WHATSAPP_HERMES_BRIDGE_URL` from the VPS `.env` so the web app stops
   delegating.

Step 3 is the irreversible one and needs a phone.

## Verification

13 tests: role resolution including the legacy flag and a typo, the exact service
matrix per role, and both halves of the self-delegation trap.
`gate:check` 0 errors · `gate:test` 616 files / 7211 tests / 0 failures.
