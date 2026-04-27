# strange_rambling_svelte — CLAUDE.md

SvelteKit personal site, live at `https://strangeramblings.com` (VPS port 4173).

- **Dev:** `npm run dev` (default port 5173)
- **Deploy:** `~/strange_rambling_svelte/scripts/deploy.sh` (always run after pushing)
- **DB:** PostgreSQL 16 + Drizzle ORM; schema changes → `npx drizzle-kit push`
- **Auth:** Google OAuth via Auth.js
- **LLM:** All AI calls via `$lib/vertex` (never direct API calls)

> **Note:** OpenClaw and the `oc` CLI were decommissioned on 2026-04-27. Some references below (notably `~/.openclaw/...` paths and the `jkai-sandbox` container) still appear in code and docs — they are paths/containers that pre-date the decommissioning and may now be inert. Verify the underlying infrastructure exists before relying on a feature that points at OpenClaw-era resources.

## Key areas

- `src/lib/workflows/` — workflow engine nodes and runners
- `src/routes/admin/` — admin UIs (blog, biome, scraper, gmail, jkai)
- `src/routes/jkai/` — jkai chat hub + autonomous builder

### Web scraper (stealth Playwright)

Two workflow nodes + supporting infra:

- `stealth-scrape` node — headless Chromium with `playwright-stealth`, persistent per-domain profiles at `~/.openclaw/scraper-profiles/<profile>/` (path predates the OpenClaw decommissioning — directory is now just an inert data folder), human pacing, form/cookie login, pagination.
- `stealth-scrape-llm` node — LLM-based field extraction over scraped HTML/text for when CSS selectors are too brittle.

**Admin UI:** `/admin/scraper` — manage encrypted login credentials, inspect browser profiles, ad-hoc test runs, last 50 run logs.

**Runtime:** The Python Playwright runner lives in `src/lib/workflows/scraper/python/scrape.py`; it executes inside the `jkai-sandbox` Docker container on homeserv via `execInSandbox`. The sandbox bind-mounts `~/.openclaw/scraper-profiles/` for cross-restart profile persistence. *Note:* `jkai-sandbox` was originally provisioned alongside the OpenClaw stack — verify the container is still running on homeserv before relying on the scraper end-to-end.

**Critical: homeserv-only.** `runScrape()` refuses to execute on any host other than `homeserv` in production (escape hatch: `SCRAPER_ALLOW_NON_HOMESERV=1`). Stealth only makes sense from a residential IP; running from the Hetzner VPS would be counterproductive and could get the IP banned.

**Env vars:**
- `SCRAPER_VAULT_KEY` — 32-byte hex — AES-256-GCM key for the credential vault. If lost, all encrypted `scraper_credentials` rows become unrecoverable.

**First-run targets:** See `docs/scraper-targets/` for verified selector maps + working ScrapeJob examples (e.g. civilservicejobs.gov.uk).

### Gmail channel

First-class workflow channel with multi-account support.

**Admin UI:** `/admin/gmail` — connect / disconnect Google accounts, manage watched Gmail queries, run test fetches. OAuth uses the shared Google client with incremental Gmail consent.

**Nodes:**
- `gmail-trigger` — start node; fires when the polling watcher sees a message matching a watch's query on the configured account.
- `gmail-fetch`, `gmail-send`, `gmail-reply`, `gmail-label`, `gmail-search` — action nodes for the downstream graph.

**Watcher:** Polls every 45 s per account via `users.history.list` keyed on a stored `gmail_history_cursors.history_id`. On `invalid_grant`, marks the account `auth_expired` and stops polling it until re-connected.

**Events:** The watcher emits on a local `gmailEventBus` (EventEmitter). `src/lib/workflows/gmail/orchestrator-bridge.ts` subscribes and routes into the workflow engine (dispatches any workflow whose start node is `gmail-trigger` with matching `accountId` + optional `watchId`) + pushes a preview into /jkai chat.

**Env vars:**
- `GMAIL_TOKEN_ENCRYPTION_KEY` — 32-byte hex — AES-256-GCM key for stored refresh tokens. If lost, all encrypted `gmail_accounts` rows become unrecoverable.

**Google Cloud Console setup:** The OAuth client needs `https://strangeramblings.com/api/gmail/callback` and `http://localhost:5173/api/gmail/callback` in its authorized redirect URIs, plus the `gmail.modify`, `gmail.send`, and `gmail.labels` scopes enabled on the consent screen.
