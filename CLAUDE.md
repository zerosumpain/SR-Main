# strange_rambling_svelte — CLAUDE.md

SvelteKit personal site, live at `https://strangeramblings.com` (VPS port 4173).

- **Dev:** `npm run dev` (default port 5173)
- **Deploy:** merge to `master`; CI builds and deploys. **Never run `scripts/deploy.sh` by hand** — a hand-rolled deploy overwrote the production `.env` with homeserv's, causing a 33-hour outage plus a public `/admin` exposure via `AUTH_BYPASS=1` (2026-07-24).
- **DB:** PostgreSQL 16 + Drizzle ORM; schema changes → `npx drizzle-kit push`
- **Auth:** Google OAuth via Auth.js
- **LLM:** All AI calls via the gateway in `$lib/jkai/llm-client` (and its wrappers, e.g. `$lib/deepdive/ai.ts`) — never direct provider SDK calls

### Merging a PR — never use `gh pr merge --auto`

SR-Main is **private on GitHub Free**, so required status checks do not exist
here: the branch-protection and rulesets APIs both 403. `--auto` therefore has
no check to wait on and merges IMMEDIATELY, cancelling the branch's in-flight
CI run. It looks like "merge when green" and is "merge now" (seen 2026-07-27,
PR #44).

Block on the conclusion and merge explicitly:

```bash
until [ "$(gh run list --branch "$BRANCH" --limit 1 --json conclusion --jq '.[0].conclusion')" != "" ]; do sleep 45; done
gh run list --branch "$BRANCH" --limit 1 --json conclusion --jq '.[0].conclusion'   # must be "success"
gh pr merge <N> --squash
```

Production itself is never at risk from this — the `deploy` job is `needs: gate`,
so a red gate cannot reach the VPS. What a premature merge costs is a red commit
on `master`.

## Key areas

- `src/lib/workflows/` — workflow engine nodes and runners
- `src/routes/admin/` — admin UIs (blog, biome, scraper, gmail, jkai)
- `src/routes/jkai/` — jkai chat hub + autonomous builder
- `src/lib/datastore/` — permanent flexible datastore (collections + jsonb records, row-level permissions, query DSL, audit, TTL). Surfaces: `database` workflow node, `datastore` toolset, `/admin/ai/datastore`. Spec: `docs/superpowers/specs/2026-07-18-datastore-and-self-improvement-design.md`
- `src/lib/selfimprove/` — nightly self-improvement engine (03:30 Europe/London, prod-only via hostname gate, kill switch `selfimprove.enabled`). Dashboard: `/admin/ai/improvement`.

  Phases: `gather → learn → discover → build → repair → optimise → propose → report`. All LLM calls are pinned to
  `SELFIMPROVE_MODEL` (`deepseek/deepseek-v4-flash`), not the chat default.

  **Tools it builds are auto-enabled and registered live** — no restart, no approval step. That is only
  safe because of `verify.ts`, which every candidate must clear: a deny-list `staticScan` over the
  handler source (blocks `process`, `require`, `import()`, `eval`, `Function()`, `.constructor`,
  `globalThis`, `fs`, `child_process`) plus a `smokeTest` in which **every** case must pass. Handlers are
  compiled with `new AsyncFunction` in full Node scope, so that scan is the only thing between
  LLM-authored text and the environment. Do not weaken it.

  `backlog.ts` is the engine's memory between nights (`improvement_backlog` collection): ideas persist
  with attempt counts and the last failure, and that failure text is fed back into the next authoring
  call. `repair.ts` re-authors existing tools with high error rates, swapping the handler in only when
  it strictly beats the incumbent on identical smoke cases. `propose.ts` turns `feature`-kind backlog
  items into **draft** PRs via `$lib/github/pr` (new files only; it has no merge call).

### Web scraper (stealth Playwright)

Two workflow nodes + supporting infra:

- `stealth-scrape` node — headless Chromium with `playwright-stealth`, persistent per-domain profiles at `~/.openclaw/scraper-profiles/<profile>/`, human pacing, form/cookie login, pagination.
- `stealth-scrape-llm` node — LLM-based field extraction over scraped HTML/text for when CSS selectors are too brittle.

**Admin UI:** `/admin/scraper` — manage encrypted login credentials, inspect browser profiles, ad-hoc test runs, last 50 run logs.

**Runtime:** The Python Playwright runner lives in `src/lib/workflows/scraper/python/scrape.py`; it executes inside the `jkai-sandbox` Docker container on homeserv via `execInSandbox`. The sandbox bind-mounts `~/.openclaw/scraper-profiles/` for cross-restart profile persistence.

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
