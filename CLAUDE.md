# strange_rambling_svelte — CLAUDE.md

SvelteKit personal site, live at `https://strangeramblings.com` (VPS port 4173).

- **Dev:** `npm run dev` (default port 5173)
- **Deploy:** merge to `master`; CI builds and deploys. **Never run `scripts/deploy.sh` by hand** — a hand-rolled deploy overwrote the production `.env` with homeserv's, causing a 33-hour outage plus a public `/admin` exposure via `AUTH_BYPASS=1` (2026-07-24).
- **DB:** PostgreSQL 16 + Drizzle ORM; schema changes → `npx drizzle-kit push`
- **Auth:** Google OAuth via Auth.js
- **LLM:** All AI calls via the gateway in `$lib/llm/client` (and its wrappers, e.g. `$lib/deepdive/ai.ts`) — never direct provider SDK calls

### Two LLM providers

`getLLMClient` is the only place provider selection happens. A model id decides
which one:

- **`openrouter`** (default) — everything without a `codex/` prefix, billed per token.
- **`codex`** — ids prefixed `codex/` (e.g. `codex/gpt-5.6-terra`), served by the
  `jkai-codex-bridge` sidecar against the ChatGPT Pro subscription. Zero cash
  cost, finite weekly quota.

Rules worth knowing before touching this:

- **Provider comes from the id prefix, not a stored field.** `coerceModelContext`
  is the single decider; persisted state often carries a bare model string with
  no provider at all. Never hardcode `provider: 'openrouter'` when writing a
  model setting — pass the id through `coerceModelContext`.
- **Codex does tool-calling** — the bridge passes caller schemas straight to the
  Responses API's `tools` param and returns `tool_calls` (it never executes
  them). **Embeddings are the one real gap**; those stay on OpenRouter. Check
  `getProviderFeatures()` rather than assuming either way.
- **The bridge talks the raw Responses API, not `@openai/codex-sdk`** (changed
  2026-08-24). The SDK drove the `codex` CLI's app-server, which injected its own
  agent scaffolding into every call: measured **12,040 prompt tokens and ~6.9s**
  for "reply ok", against **26 tokens and 1.4s** on the raw API. It also could
  not stream — one block per turn — which is why chat felt slower after the
  gateway was retired (it had used this same raw transport). Rollback without a
  deploy: set `CODEX_BRIDGE_TRANSPORT=sdk` and restart the service.
- **Codex still costs a round trip per tool call**, but ~1.4s, not ~10s. A long
  builder chain is no longer the crawl it was.
- **Codex is text-only.** Anything that builds its own content parts must check
  `getModelCapabilities()` first — the site default may now be a Codex model.
  **`/jkai` chat asks a different question**: `getChatInputCapabilities(ctx)`,
  which reports what the CHAT can accept rather than what the model can. Images,
  PDFs and audio are pre-analysed into text (`$lib/jkai/media/preanalyse`) when
  the model cannot read them natively, so the composer must not grey them out —
  applying the model gate there dropped every image John attached, twice. Video
  stays gated on the model, because nothing can extract text from it.
- **Codex prices as `null`, never `0`** — no cash cost, but real quota spend.
- The bridge lives in `packages/jkai-codex-bridge` (see its README). A merge to
  master deploys it via `scripts/ci-stage-sidecars.sh` in the release job;
  `scripts/deploy-codex-bridge.sh` is the by-hand escape hatch. Plain
  `ci-deploy.sh` never syncs `packages/`. It needs `codex login --device-auth`
  once per host — and the bridge now refreshes that token itself
  (`src/codex-auth.ts`), since the CLI is no longer in the path to do it.

### Merging a PR — never use `gh pr merge --auto`

`--auto` has no check to wait on unless a required status check is configured,
so it merges IMMEDIATELY, cancelling the branch's in-flight CI run. It looks
like "merge when green" and is "merge now" (seen 2026-07-27, PR #44).

The reason given here used to be that required status checks "do not exist on
GitHub Free — the branch-protection and rulesets APIs both 403". **That was
wrong.** Neither API 403s: branch-protection returns 404 ("Branch not
protected") and rulesets returns `[]`, both meaning "none configured". Creating
an active ruleset with a `required_status_checks` rule on master succeeds here
— verified 2026-08-09 by creating one and deleting it. Only
`enforcement: evaluate` needs Enterprise. So `--auto` can be made to work; it
just has nothing to wait for until a ruleset exists.

Block on the conclusion and merge explicitly:

```bash
until [ "$(gh run list --branch "$BRANCH" --limit 1 --json conclusion --jq '.[0].conclusion')" != "" ]; do sleep 45; done
gh run list --branch "$BRANCH" --limit 1 --json conclusion --jq '.[0].conclusion'   # must be "success"
gh pr merge <N> --squash
```

Production itself is never at risk from this — the `deploy` job is `needs: gate`,
so a red gate cannot reach the VPS. What a premature merge costs is a red commit
on `master`.

## Field studies

Research projects under `/projects/<slug>` are **field studies** and follow the Field Study
System in `field-study-system/`. Do not design these pages ad hoc.

When asked to create or edit a field study:

1. Read `field-study-system/INSTRUCTIONS.md` and follow the procedure.
2. Author content as data in `src/routes/projects/<slug>/study.ts`, validated against
   `field-study-system/content.schema.json`.
3. Every beat declares a `template` from `templates.json` (T0–T8). Render with the
   primitives in `src/lib/fieldstudy/`. Never write a bespoke page layout.
4. Before opening a PR, run `field-study-system/CHECKLIST.md` and paste the result into the
   PR description.

Hard constraints, in priority order over any aesthetic judgement:

- `Confidence = 'fact' | 'hypothesis' | 'contested'` — the shipped type in
  `src/lib/fieldstudy/types.ts`. Do not invent levels or rename these.
- Categorical hues (`#7a5aa6` identifier, `#3a8658` operational/federated, `#b4632e`
  standards, `#8a2d3a` trust/governance) appear only inside a legend and the marks that
  legend labels. Never in chrome, never on a claim. They live in `src/app.css` as
  `--fs-cat-*` and are shared with jkai's chat charts
  (`src/lib/jkai/artifacts/vega-theme.ts`) — one ramp, not two.

  **`operational` was `#2f7d4f` until 2026-09-05.** Against `standards` it scored OKLab
  ΔE 4.0 under protanopia, against a floor of 6, so the two read as one colour to a
  red-blind viewer. `#3a8658` is the same green to a full-colour eye (0.031 drift in
  OKLCH) and scores 6.2. Re-step it only with the dataviz skill's
  `validate_palette.js`, never by eye, and keep the set at four — a fifth series folds
  into "other" or facets. The pair still sits in the 6–8 band, which is legal only
  alongside a secondary encoding, so a legend or direct labels are mandatory wherever
  these are used.
- Confidence chips use the site palette: petrol `--accent-ink` for fact, orange `--accent`
  for hypothesis, claret `#8a2d3a` for contested.
- Radius `0`, `2px` or `100px` only. No shadows inside a page. No emoji.
- Instruments (T5) are control surfaces: no serif, no drop caps, no margin notes, no page
  scroll, no autoplay when embedded in a beat.

If a beat does not fit a template, that is a signal the beat is two beats. Split it. Do not
add a tenth template without being asked.

**Two deviations from the shipped kit, both deliberate** (see
`docs/superpowers/specs/2026-08-15-field-study-system.md`): the kit's 8.5–11px label sizes
are mapped onto the site type scale because the 12px floor is gated sitewide; and the kit's
`--fs-body` / `--fs-mono` font-family aliases are dropped in favour of the site's existing
`--font-body` / `--font-mono`, because `--fs-body` already means `1rem` here and
redefining it would invalidate 82 `font-size` declarations. Only `--fs-serif` is new.

## Key areas

- `src/lib/workflows/` — workflow engine nodes and runners
- `src/routes/admin/` — admin UIs (blog, scraper, gmail, jkai)
- `src/routes/jkai/` — jkai chat hub + autonomous builder
- `src/lib/datastore/` — permanent flexible datastore (collections + jsonb records, row-level permissions, query DSL, audit, TTL). Surfaces: `database` workflow node, `datastore` toolset, `/admin/ai/datastore`. Spec: `docs/superpowers/specs/2026-07-18-datastore-and-self-improvement-design.md`
- `src/lib/codegraph/` — the **build-history knowledge graph**. Nodes are files and gates;
  episodes (a gate failed, edits followed, the gate passed) and lessons (the 272 curated
  `~/.claude/.../memory/*.md` notes, imported verbatim) hang off them. Surfaces:
  `/jkai/codegraph` (ER map, ask, review + forget, serves), the `codegraph` toolset, and
  `scripts/codegraph-query.mjs`.

  **Retrieval is keyed on code first, prose last.** 29% of John's prompts are ≤25 chars,
  so "crack on" embeds to nothing. The two sharp keys are mechanical and cost no LLM call:
  the FILE SET a build is touching, and the FINGERPRINT of the gate error it just hit
  (`orchestrator.ts` has already appended those diagnostics to `evaluation`). Both are
  retrospective, so a greenfield task ("add a Notion connector") matches neither — for
  that, and only after both decline, `planBuildQuery` falls back to a `topic:` seed built
  from the task text. It needs three meaningful tokens, so the short prompts that
  motivated keying on code still plan nothing at all.

  **Two channels, and neither is the tool bridge.** All 5,214 tool actions across 280
  production build iterations are pi built-ins — the bridge has never once been called.
  So: PUSH is computed in-process at `executor.ts` and appended to the user prompt; PULL
  is `scripts/codegraph-query.mjs` over **bash**, the only transport pi never strips.
  A new script needs its own rsync line in `ci-release.sh` or it silently does not exist
  in production.

  **Forgetting is a tombstone with a required reason**, filtered in exactly one place
  (`retrieve.ts`). Staleness (every cited path gone from that repo) ranks a lesson down
  and flags it; it never hides it on its own, and the sweep refuses to run when its
  sentinel check fails rather than quarantining the whole corpus.

  Backfill: `node scripts/codegraph-backfill.mjs --all` on homeserv (the transcripts are
  858 MB and live only there). Spec: `docs/superpowers/specs/2026-08-17-code-memory-graph.md`.

- `src/lib/selfimprove/` — nightly self-improvement engine. **Scheduled by the heartbeat, not a cron of its own**: the `daydream-improve` activity, window 02:30–03:55 Europe/London, prod-only via hostname gate, kill switch `selfimprove.enabled`. This file used to say "03:30" and a private croner; the second scheduler was retired 2026-08-30 (see `docs/superpowers/specs/2026-08-30-daydream-absorbs-selfimprove.md`). Dashboards: `/admin/ai/improvement` + `/jkai/improvement`, both reading the live heartbeat row for the schedule rather than a constant.

  Phases: `gather → learn → discover → build → repair → optimise → propose → report`. All LLM calls are pinned to
  the `jkai.selfimprove.model` setting (falling back to `SELFIMPROVE_MODEL`, shipped as
  `deepseek/deepseek-v4-flash`), not the chat default. On production that setting pointed
  at a Codex model as of 2026-09-03, so its calls were quota, not cash — the
  Engine room's cash deck reads the ledger rather than the run's own (unpriced) total.

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
