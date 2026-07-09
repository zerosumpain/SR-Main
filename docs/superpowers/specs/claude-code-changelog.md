# Spec — Claude Code Changelog (admin)

**Status:** in progress (autonomous build, Full grade)
**Date:** 2026-07-09
**Owner:** John (built autonomously by Claude)

## Goal

An admin page showing a changelog of Claude Code engagements on the strangeramblings.com
codebase. Each session is decomposed into **ordered stages** — `request`, `design`,
`plan`, `result`, `fixes` — ordered by date. The viewer can read the **raw prompts/plans**
verbatim, and see **categorical information** about them: term frequency, feature types,
token costs. The system must **automatically ingest future Claude engagements, including
the current one**.

## Data source (linchpin)

Claude Code writes one JSONL transcript per session at
`~/.claude/projects/-home-john/<session-uuid>.jsonl` (on homeserv). 58 top-level session
files, ~287 MB. Each line is an event: `user` / `assistant` / `attachment` / `system` /
`mode` / `ai-title` / `last-prompt` / `file-history-snapshot`.

- `assistant.message.usage` → `input_tokens`, `output_tokens`, `cache_read_input_tokens`,
  `cache_creation_input_tokens` (+ `cache_creation.{ephemeral_5m,ephemeral_1h}`) and `model`
  → **accurate token costs**.
- `ai-title` → session title; `message.content` blocks (`text`/`thinking`/`tool_use`/`tool_result`);
  `timestamp`, `cwd`, `gitBranch` on every message.
- **cwd is uniformly `/home/john`** → project attribution must come from *content*
  (dominant top-dir of Edit/Write `file_path`), not cwd.
- **Nobody uses plan-mode (0/58)** → the `plan` stage keys off the `superpowers:writing-plans`
  skill + written plan files, not `mode: plan`.

## Stage segmentation (validated on real transcripts)

Skill invocations are the gold-standard stage signal. Walk the ordered user/assistant
messages; assign each a stage, merge consecutive same-stage messages into ordered segments:

- **request** — first substantive user prompt; later user prompts are `request` (new feature)
  unless they read as a correction after a result → `fixes`.
- **design** — assistant spans containing `Skill(brainstorming|solution-design|frontend-design|sr-design|dataviz)`.
- **plan** — `Skill(writing-plans)`, `ExitPlanMode`, or a Write to a `plans/` path.
- **result** — `Skill(executing-plans|ship|bundle-deploy|subagent-driven-development|…)` or
  Edit/Write/NotebookEdit/Bash(deploy·build·commit) bursts.
- **fixes** — `Skill(systematic-debugging)`, or a bug-report follow-up prompt after a result.
- Assistant messages with no signal inherit the current stage.

Validated: the 1726-message policy-engine session decomposes into 39 ordered segments that
mirror its real multi-day arc. Raw prompt text (request/fixes) and plan text (plan) are stored
verbatim; result/design segments store a compact action trace + summarising prose.

## Architecture (decided)

**homeserv can't write prod directly.** homeserv's `DATABASE_URL` → a *local dev* Postgres
(localhost:5433); prod Postgres is VPS-local and not externally reachable. Therefore
ingestion mirrors the policy-engine precedent: a homeserv job parses local transcripts and
**POSTs** to a token-gated ingest API on the VPS.

```
homeserv cron ──(parse-transcript.mjs)──► POST https://strangeramblings.com/api/admin/claude-changelog/ingest
   scans ~/.claude/**.jsonl                 (token-gated, hooks bypass)
   skips unchanged (contentHash)                    │
                                                     ▼
                                        upsert claude_sessions + claude_session_stages
                                        (+ best-effort LLM narrative enrichment)
                                                     │
                                                     ▼
                                 /admin/ops/claude-changelog  (+page.server.ts reads prod DB)
```

- **Parser** (`scripts/claude-changelog/parse-transcript.mjs`, pure Node): transcript → payload
  (session metrics + ordered stages). Deterministic: token cost from a pricing map, term
  frequency, feature-type multi-labelling, project attribution.
- **DB** (`src/lib/db/schema.ts`): `claude_sessions` + `claude_session_stages` (additive,
  applied by `deploy.sh` → `drizzle-kit push`).
- **Ingest endpoint**: upsert by `id`; skip if `contentHash` + `schemaVersion` unchanged;
  replace stages on change. Optional best-effort LLM narrative summary per session (falls back
  to the deterministic extractive summary).
- **Ongoing capture**: (1) homeserv systemd-timer/cron every ~15 min (catch-all + re-ingests
  the live current session); (2) a Claude Code `SessionEnd`/`Stop` hook for near-instant capture
  of *this* and future sessions. Cron is the backbone; the hook is the "including this one" win.
- **UI**: `/admin/ops/claude-changelog` — KPI tiles, project/stage/search filters, session
  cards → ordered stage sub-cards, raw prompt/plan viewer modal, term-freq + feature-type +
  cost-over-time categorical panels. SR design system (`.nm-sec` etc.).

## Files to touch

| File | Why |
|---|---|
| `scripts/claude-changelog/parse-transcript.mjs` | transcript → payload (DONE) |
| `scripts/claude-changelog/ingest.mjs` | homeserv scan + POST + backfill |
| `scripts/claude-changelog/claude-changelog.timer/.service` OR crontab | schedule |
| `.claude/settings.json` (hook) | SessionEnd hook → instant ingest |
| `src/lib/db/schema.ts` | 2 new tables (DONE) |
| `src/routes/api/admin/claude-changelog/ingest/+server.ts` | ingest endpoint |
| `src/hooks.server.ts` (PUBLIC_API_PATHS or equiv) | bypass auth for the ingest POST |
| `src/routes/admin/ops/claude-changelog/+page.server.ts` | load from prod DB |
| `src/routes/admin/ops/claude-changelog/+page.svelte` | UI |
| admin Ops nav config | register the new sub-link |
| env: `CLAUDE_CHANGELOG_INGEST_TOKEN` on VPS + homeserv | shared secret |

## Verification

- Parser: `node parse-transcript.mjs <file>` → sane payload (DONE — validated on 3 sessions).
- Ingest: `curl -H "x-ingest-token: …" -d @payload.json …/ingest` → 200 + rows in DB.
- Live: load `/admin/ops/claude-changelog` on strangeramblings.com; the current session
  appears with its stages + raw prompt visible.
- Ongoing: timer active (`systemctl --user list-timers`) / crontab present.

## Decision Log

| # | Decision | Options considered | Chosen — why | Reversible? |
|---|---|---|---|---|
| 1 | Ingestion transport | (a) homeserv writes prod DB directly (b) homeserv POSTs to VPS API | **(b)** — homeserv DATABASE_URL is a *local dev* DB; prod is VPS-only. Matches policy-engine precedent. | Yes |
| 2 | Stage segmentation | (a) pure heuristic (b) LLM-classified (c) hybrid | **(a) deterministic backbone**, LLM only for optional prose summaries — signals (skills/edits) are strong and cheap; keeps ingest robust & free. | Yes (re-run parser) |
| 3 | Scope of sessions | (a) only strange-rambling-svelte (b) all, tagged by project | **(b)** ingest all, attribute by touched paths, default the UI to the site's work with a project filter. cwd can't discriminate. | Yes |
| 4 | Token cost | (a) tokens only (b) tokens + est USD | **(b)** — accurate token counts (primary) + a clearly-labelled USD estimate from a pricing map. | Yes |
| 5 | Ongoing capture | (a) cron only (b) hook only (c) cron + SessionEnd hook | **(c)** — cron is the robust catch-all + re-ingests the live session; hook gives instant "including this one". | Yes |
| 6 | Ingest auth | (a) owner session (b) shared bearer token + hooks bypass | **(b)** for the machine-to-machine POST (no session on homeserv); read paths use the normal owner gate. | Yes |
| 7 | Raw text storage | full transcript vs excerpts | **excerpts** — verbatim prompts/plans, compact action traces elsewhere, capped ~20 KB/stage. Keeps payload small; raw prompts/plans preserved as required. | Yes |
