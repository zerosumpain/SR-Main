# Stage 3 — a real browser, on the residential IP

**Status:** shipped · **Date:** 2026-08-24 · Hermes exit plan, S3

## Problem

`browser_*` is the one Hermes capability with no in-repo equivalent: 96 calls in
14 days, and the only category that cannot simply be rebuilt on the VPS. A
datacentre IP trips exactly the bot-walls that make a real browser worth having —
`scraper/runner.ts:39-61` already refuses to scrape from one for that reason.

Measured use over 30 days, top-level chat sessions: console 74, navigate 52,
click 21, snapshot 20, vision 6, scroll 1, get_images 1. Across 20 sessions.
That shape is site-debugging, not scraping.

## Design

Mirrors the scraper exactly, because the constraint is identical:

- On homeserv, drive a local browser. Anywhere else, proxy over Tailscale via
  `BROWSER_SERVICE_URL` → `homeserv:5173/api/browser`.
- `python/browser-session.py` is a long-lived daemon inside `jkai-sandbox`
  holding one Playwright page, serving verbs over HTTP on the docker bridge. It
  is a daemon rather than a one-shot script because `navigate` → `click` →
  `snapshot` must act on the same page.
- Idle-reaped after 15 minutes; `browser_close` frees it sooner.

## Decision Log

| # | Decision | Options | Chosen | Why | Reversible |
|---|---|---|---|---|---|
| 1 | Where it runs | VPS / homeserv | **homeserv** | The residential IP is the entire reason this capability is worth having, and it is why homeserv survives the Hermes exit at all. | Yes, one env var |
| 2 | Session model | one-shot per verb / long-lived daemon | **Daemon** | State between calls is the feature. A one-shot script cannot click what it just navigated to. | Yes |
| 3 | Transport into the sandbox | CDP / stdin pipe / HTTP daemon | **HTTP on the docker bridge** | `getContainerIp()` and detached `docker exec -d` already exist and are proven by `interactive.ts`. CDP re-attachment is fiddlier for no gain. | Yes |
| 4 | Dependencies | aiohttp / stdlib | **stdlib http.server** | The sandbox has no aiohttp and six local routes do not justify adding one. | Yes |
| 5 | `browser_vision` | port it / omit | **Omit** | 6 calls, and the vision path already exists in `$lib/file-index/describe`. A second front door to the same model is worse than none. | Yes, add later |
| 6 | Failure mode | throw / fail soft | **Fail soft** | A browser is a nice-to-have on a chat turn. The error text tells the model to say so rather than guess at a page it never saw. | Yes |
| 7 | Always-on? | yes / opt-in | **Opt-in** | It costs a Chromium. Discovery is always-on because it is free; this is not. | Yes |

## Bug found while building

Clicking a link on a SvelteKit page reported success with the **old** URL:
`domcontentloaded` returns instantly on a client-side route change because the
document never reloads. Since the site most often being debugged here is exactly
that SPA, `_settle()` now waits for the URL to move and the network to quieten,
and reports a `navigated` flag. Verified live: `navigated=true`,
`url=https://strangeramblings.com/projects`.

## Deployment

Two steps beyond the merge, both required:

1. `BROWSER_SERVICE_URL` on the VPS `.env` (which is `chattr +i` — toggle
   deliberately, never rsync over it).
2. homeserv's own checkout must be pulled and rebuilt: it serves `/api/browser`
   and CI does not deploy there.

## Verification

- 15 unit tests: routing (local vs proxy), the refusal to browse from a
  datacentre IP, fail-soft on an unreachable homeserv, bounded proxy, envelope
  mapping, argument pass-through.
- Live on homeserv before shipping: navigate to strangeramblings.com (200,
  correct title), snapshot (real text, 27 links), console, click with SPA
  navigation, every error path, and clean shutdown.
