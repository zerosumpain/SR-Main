# JKAI Builds Redesign — Design Spec

**Date:** 2026-04-26
**Status:** Approved (autonomous implementation authorised by user)
**Implementer:** Claude (Opus 4.7)

## 1. Goals

Rework `/jkai/builds` so that:

1. The page follows the site's `nm-tokens` design language (the same one used by `/jkai/canvas`), replacing the current Tailwind-styled prototype.
2. The user has greater control and influence over each build's *strategy* (plan-first iteration, milestones, mid-flight steering) and *execution* (budget, model, thinking level, sandbox controls, design-system enforcement).
3. The build is "hands on" — a Watch / Tinker / Drive mode switcher lets the user observe (Watch), tinker with files & shell (Tinker), or take over the build's pi session interactively (Drive). Watch ships in Phase 1; Tinker and Drive ship in Phase 2.
4. Every JKAI registry tool (`build_*`, `research_*`, `health_*`, `blog_*`, `workflow_*`, `gmail_*`, `intel_*`, etc.) is callable from inside the build sandbox via a pi extension (`jkai-tools.ts`) that registers each one as a first-class pi tool — typed args, validated, traced.
5. The site's design system is **always** respected by builds (default-on per-build toggle). Tokens + a components cheatsheet + canonical example are mounted into the sandbox as a read-only `/design-system/` directory; the system prompt instructs pi to lift from these; a post-iteration linter rejects iterations that hard-code colours, fonts, or rely on Tailwind (when the toggle is on).
6. Streaming activity is rendered as three structured lanes (Thinking, Tools, Output) with proper code blocks (Prism + cream-on-dark `pre`), a per-file timeline of every `write`/`edit` (latest-first, diff-against-previous), and automatic compaction of long thinking blocks into one-line headlines.

## 2. Non-Goals

- Changing the underlying pi-runner / docker-exec execution model.
- Replacing the SSE transport (it works; we extend the event vocabulary).
- Building Tinker/Drive in Phase 1 (deferred — see §10).
- Refactoring the JKAI tools registry itself.

## 3. Architecture Overview

```
                ┌───────────────────────────┐
   Browser  ←──→│  /jkai/builds   (list)     │
                │  /jkai/builds/[id] (detail)│
                └─────────┬─────────────────┘
                          │ SSE (existing)
                          ▼
                ┌───────────────────────────┐
                │  Orchestrator  (Phase-1+)  │
                │  - plan-first gate         │
                │  - milestone tracking      │
                │  - linter post-iter        │
                │  - design-system mount     │
                └─────────┬─────────────────┘
                          │ docker exec
                          ▼
                ┌───────────────────────────┐
                │  jkai-sandbox container    │
                │  ┌─────────────────────┐   │
                │  │ pi --extension      │   │
                │  │   jkai-tools.ts     │───┼─► HTTP back to
                │  │ --skill design-sys  │   │   /api/jkai/tools/invoke
                │  └─────────────────────┘   │
                │  /workspace/dev (project)  │
                │  /design-system (RO mount) │
                └───────────────────────────┘
```

## 4. Data Model Changes

All additive. Existing rows continue to work via defaults.

### 4.1 `jkai_builds` (new columns)

| Column | Type | Default | Purpose |
| --- | --- | --- | --- |
| `enforce_design_system` | `boolean` | `true` | Q4-D toggle |
| `plan_status` | `text` | `'approved'` | `pending`/`approved`/`skipped` — gates iteration 1 onwards. Default `approved` so legacy builds keep working; new builds created via v2 UI default to `pending`. |
| `milestones` | `jsonb` | `'[]'` | `[{id, title, done, iterationCompleted}]` — derived from plan markdown |
| `require_iteration_approval` | `boolean` | `false` | Q5-C per-build per-iter gate (Phase 2) |
| `thinking_level` | `text` | `'medium'` | Pi thinking flag (off/min/low/med/high/xhigh) |
| `enabled_toolsets` | `jsonb` | `'["all"]'` | List of toolset names exposed via the pi extension; `["all"]` = no filter |

**Plan storage**: the markdown plan body lives on iteration #0's existing `plan` column (`jkai_iterations.plan`). No new column needed there.

**New status value**: `awaiting_plan_approval` joins the existing enum (`pending`/`running`/`paused`/`completed`/`failed`). The status is text — no schema change for the enum itself.

Migration: `npx drizzle-kit push` (additive, no destructive change).

### 4.2 `jkai_logs` (new `type` values)

No schema change. New permissible values for `type`:

- `plan` — proposed plan body (one log row per iteration-0 plan emit)
- `milestone` — content is `{milestoneId, action: 'completed' | 'added'}`
- `lint` — design-system lint findings

The streaming endpoint passes these through unchanged; the new UI knows how to render them.

### 4.3 New SSE event types (transient, negative IDs)

Added to `LiveEvent` union in `src/lib/jkai/log-emitter.ts`:

- `plan_proposed` — `{ plan: string, iterationId }`
- `iter_summary_start`, `iter_summary_end` — wraps thinking compaction; UI auto-collapses thinking when end fires with `headline`.

## 5. Components

### 5.1 New shared components (`src/lib/builds/`)

- `Activity.svelte` — three-lane container; receives the unified event stream, groups by `iterationId`, renders one `IterationCard` per iteration.
- `IterationCard.svelte` — collapsible per-iteration container. Header: number, status dot, duration, token count. Body: three lanes.
- `LaneThinking.svelte` — collapsed by default. Title is the headline (last `iter_summary_end.headline` for that turn) or "Thinking…" when streaming. Click to expand full text.
- `LaneTools.svelte` — flat list of `ToolPill` components (one per tool start/end pair). Tool names render as monospace pills with `nm-inline`-style chrome; expanded shows args (JSON, syntax-highlighted) and result.
- `LaneOutput.svelte` — pi's free-form text + final iteration prose, rendered via `ChatMarkdown`.
- `ToolPill.svelte` — collapsed pill with tool name + status dot; expanded panel.
- `FilesTimeline.svelte` — sidebar tab. Aggregates every `write` / `edit` from the persisted iteration `actions` JSON, grouped by path, latest first. Per row: filename, last action, line-count delta, expand → diff (using a tiny inline differ — no extra dep).
- `PlanEditor.svelte` — markdown textarea + render preview. Buttons: Approve & Start, Re-plan, Skip plan & Code Now.
- `MilestoneList.svelte` — sidebar widget; shows `[ ]` / `[x]` items, click to mark, "Add milestone" inline input.
- `BuildSidebar.svelte` — right-rail container holding: budget summary, model picker, thinking-level slider, design-system toggle, sandbox controls (reset workspace / snapshot / restore), milestones, "Require approval per iter" checkbox.
- `ModeSwitcher.svelte` — segmented control (Watch / Tinker / Drive). Tinker + Drive disabled with tooltip "Coming soon" in Phase 1.
- `WatchPane.svelte` — Phase-1 "hands on": read-only file tree of the dev workspace + log tail. Built on top of a new `/api/jkai/builds/[id]/files` endpoint that lists & reads files in `~/.openclaw/jkai-builds/<id>/dev/`.

### 5.2 Page rewrites

- `src/routes/jkai/builds/+page.svelte` — canvas-style list (page header, kicker, grid of `nm-sec` cards with status dots).
- `src/routes/jkai/builds/[id]/+page.svelte` — split layout: left = activity (5.1), right = sidebar (5.1).

### 5.3 Feature flag

`PUBLIC_BUILDS_V2` env var. When unset / `false`, the existing Tailwind UI continues to render. When `true`, the new pages render. Default in `.env.example` is `true`; the prod env will be flipped at the very end of the run after I'm satisfied.

## 6. Pi Extension: `jkai-tools.ts`

Lives at `~/.openclaw/extensions/jkai-tools/index.ts` (new directory), mounted into the sandbox at `/extensions/jkai-tools/`. Loaded via `pi -e /extensions/jkai-tools/index.ts`.

Behaviour:

1. On startup, fetch the toolset manifest from `http://host.docker.internal:5173/api/jkai/tools/manifest` (new endpoint that exposes `getToolDefinitions()` JSON-Schema).
2. For each tool in the manifest, register a pi tool: `name`, `description`, parameter schema converted to pi's tool-arg shape.
3. Tool handler POSTs `{ name, args }` to `/api/jkai/tools/invoke` with a per-build bearer token (env var `JKAI_BUILD_TOKEN` injected at container start).
4. Response forwarded back to pi as the tool result (string or JSON).
5. The whole thing emits standard pi `tool_start` / `tool_end` events, so the new Activity UI renders them automatically.

Tool registry endpoints (new):

- `GET /api/jkai/tools/manifest` → `{ tools: ToolDefinition[] }` (filtered by build's allowed toolsets — initially "all").
- `POST /api/jkai/tools/invoke` → executes the registry handler; require bearer token.

## 7. Design System Enforcement

### 7.1 Mounted assets (`/design-system/` in sandbox, read-only)

Generated by a one-off script `scripts/generate-design-system-assets.ts` (run at container build OR lazily on first build start, cached in `~/.openclaw/design-system-cache/`):

```
/design-system/
  README.md          ← "Read this first"; lists rules + canonical examples
  tokens.css         ← the contents of src/app.css `:root { ... }` + nm-tokens.css
  components.md      ← cheatsheet: .nm-sec / .nm-text-input / .nm-save-btn / .row-link / .status-dot, with HTML+CSS examples
  examples/
    page.svelte      ← canonical "list page" lifted from /jkai/canvas
    detail.svelte    ← canonical "detail page" lifted from /jkai/canvas/[slug]
```

### 7.2 System-prompt addition

Conditional on `enforceDesignSystem === true`:

> "This site has a strict design system. Read `/design-system/README.md` first. Always import `tokens.css` (or copy the relevant CSS variables) into any HTML/Svelte you produce. Use the documented classes (`.nm-sec`, `.nm-text-input`, `.nm-save-btn`, `.row-link`, status dots). Do not hard-code hex colours. Do not use Tailwind. Do not use arbitrary fonts. The post-iteration linter will reject your work if you violate these rules."

### 7.3 Linter (`src/lib/jkai/design-lint.ts`)

Scans every changed file in `dev/` after each iteration. Rules (when `enforceDesignSystem === true`):

- **No raw hex colours** outside `tokens.css` (`#[0-9a-fA-F]{3,8}`).
- **No Tailwind class soup** (`/\bclass="[^"]*\b(bg-|text-|p-|m-|w-|h-|flex|grid)/`).
- **No `font-family:` declarations** that don't reference `var(--font-*)`.

Findings written to `jkai_logs` as `type='lint'`. If non-empty: iteration is marked failed, findings are fed into the next iteration's user prompt as required fixes.

If `enforceDesignSystem === false`: linter skipped entirely.

## 8. Plan-First Iteration Flow

The planner already exists (`src/lib/jkai/planner.ts`, proposer/critic debate, persists output to iteration #0's `plan` column). The redesign adds a **gate** in front of the existing iteration loop, plus a UI to render and edit the plan.

1. New build created → orchestrator's `initAndPlan()` calls `planBuild()` (existing) which produces iteration #0 with `plan` populated.
2. **New gate**: after `planBuild()` returns, if `plan_status === 'pending'` (default for builds created via the new UI), the orchestrator transitions build status to `awaiting_plan_approval` (new status value, additive) and stops scheduling — does NOT call `scheduleNext()`.
3. UI: `PlanEditor` shown front-and-centre when status is `awaiting_plan_approval`. User edits markdown, clicks **Approve & Start** (sets `plan_status='approved'`, status back to `running`, calls `orchestrator.resumeBuild()`), **Re-plan** (clears iter 0, calls `planBuild()` again), or **Skip & Code Now** (sets `plan_status='skipped'`, status `running`, schedules iter 1).
4. From iteration 1 onwards: existing logic — `projectPlan` is fetched from completed iter 0 and included in every iteration's user prompt.
5. Backwards-compatible default: `plan_status='approved'` — existing builds (created before the migration) skip the gate and behave exactly as before.

Milestones (`jkai_builds.milestones` JSONB) are derived from the plan markdown's `### Iteration N: [title]` + `- Milestone:` lines on plan-save, so the sidebar can show progress as iterations complete. Server-side parser lives in `src/lib/jkai/plan-parse.ts`.

## 9. Three-Lane Activity Rendering

Reducer pattern: a single `feed` derived from the SSE stream, grouped by `iterationId`. For each iteration:

- **Thinking lane**: concatenation of all `stream_thinking` deltas. On `iter_summary_end` with `headline`, the lane collapses with the headline as the title. Click to expand the full reasoning. If no headline arrives, fall back to "Thinking…".
- **Tools lane**: list of `{toolName, args, status, result}`. Built from `stream_tool_start` / `stream_tool_delta` / `stream_tool_end` plus persisted `tool` log rows (replay).
- **Output lane**: concatenation of `stream_text` deltas, rendered as markdown when finalised.

Code blocks inside Output and inside expanded ToolPill bodies render via `ChatMarkdown` (already exists, uses Prism). Per-block copy button (4-line vanilla JS, no new dep).

## 10. Phase Plan

### Phase 1 (this session, autonomous)

- DB migration (additive columns).
- New SSE event types.
- Pi extension `jkai-tools.ts` + manifest/invoke endpoints.
- Design-system asset bundle + sandbox mount + system-prompt injection + linter.
- Plan-first iteration in orchestrator.
- All new Svelte components from §5.1.
- Page rewrites for `/jkai/builds` and `/jkai/builds/[id]` behind `PUBLIC_BUILDS_V2`.
- ModeSwitcher (Watch enabled; Tinker + Drive show "Coming soon").
- WatchPane (read-only file tree + tail).
- Tests: orchestrator plan-first gate, linter, manifest endpoint auth, Activity reducer.
- `npm run check` + `npm run build` clean.
- Push + run `~/strange_rambling_svelte/scripts/deploy.sh`.

### Phase 2 (deferred — written up here for handoff)

- Tinker pane: Monaco editor wired to `/api/jkai/builds/[id]/files/[...path]` (GET/PUT). xterm.js terminal wired through a websocket to `docker exec -it jkai-sandbox bash`. Concurrency: while build is running, terminal is read-only (`docker exec` with `tail -f`); to *write*, user pauses build.
- Drive pane: pi's RPC mode (`pi --mode rpc`) — the build's pi session is paused, an RPC client in the browser sends user messages, pi responds, the build resumes when user clicks "Resume autonomous". Needs careful state machine around the existing iteration loop.
- Per-iteration approval gates (Q5-C): trivial UI on top of Phase 1 plan-status plumbing.
- Sandbox controls: reset workspace / snapshot / restore via new orchestrator endpoints.

## 11. Testing

- Vitest unit tests for: linter rules, plan parser, activity reducer, manifest endpoint shape, invoke-endpoint auth.
- Manual smoke (recorded in PR description): create new build, see plan, approve, watch three lanes stream, see milestones tick, watch linter reject a stub iteration, see file timeline.
- `npm run check` (svelte-check) and `npm run build` (production build) must pass.

## 12. Risk & Rollback

- Feature flag default-off until the very last commit; if anything in production looks broken, set `PUBLIC_BUILDS_V2=false` and redeploy — old UI is unchanged.
- DB migration is additive; rollback = leave new columns in place and unset the flag.
- Pi extension load is conditional on `PUBLIC_BUILDS_V2` AND `enforceDesignSystem`; existing builds (no flag) keep running with the legacy `--no-skills --no-extensions` invocation, so old behaviour is preserved.
