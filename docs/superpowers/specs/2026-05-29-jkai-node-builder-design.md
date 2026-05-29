# jkai-node-builder — design

**Status:** draft
**Date:** 2026-05-29
**Author:** John Kelly (with Claude)
**Supersedes:** `/jkai/curate` experience (will be demolished)

## Summary

Replace the `/jkai/curate` experience with a **single Hermes skill** —
`jkai-node-builder` — that lets Hermes notice, mid-chat, when an existing
workflow node won't satisfy the user's request and build a new one as a
first-class, user-configurable component. The skill is invoked by `jkai-canvas`
and `jkai-general` via the standard Hermes yield mechanism. There is no
custom UI, no phase machine, no per-session worktree — just MCP tools and a
SKILL.md.

The durable IP from curate — the codegen library that emits a NodeSpec into
real source files (definition / executor / Svelte panel / sr-docs /
registry+index patches) — is extracted, moved to `src/lib/node-builder/`, and
exposed via MCP. The LLM agent loop replaces curate's phase machine; the
chat's existing tool-step UX replaces the curate session view.

## Motivation

`/jkai/curate` was shipped 2026-05-07 as a parallel experience for designing
new workflow nodes. It works end-to-end (Apple Calendar shakedown) but in
practice never gets used: users discover the gap while building a workflow in
the canvas chat, not while sitting on `/jkai/curate`. The phase machine,
per-session worktree, port allocator, dev server, and bespoke SSE bus are all
load-bearing for a flow no one starts. Meanwhile, the Hermes migration
(phases 0/1/1.5 merged, soak pending) has given us a proper agent loop and a
skill system that can drive the same outcome more naturally:

> Hermes is the brain. SvelteKit is presentation + tool host. Adding new
> capabilities is a SKILL.md + a few MCP tools, not a new route.

So we replace the experience layer with a skill and reuse the codegen.

## Out of scope

- Changes to the integrations infrastructure
  (`integration_credentials`, AES-256-GCM crypto, `/admin/integrations`,
  `CredentialPicker`, `CredentialStatusBanner`, `TestConnectionAction`,
  `registerIntegrationAdapter`). All kept as-is — they are not curate-specific
  and are reused by every node that needs credentials.
- Changes to the workflow engine or canvas UI.
- Changes to the deploy pipeline (`scripts/deploy.sh` keeps its current shape).
- Auto-deploy without an approval gate. The gate is the whole point of the
  design.
- Backwards compatibility for `curate_sessions` rows. Curate was never
  promoted out of beta.

## Demolition + codegen rescue

### Delete

- `src/routes/jkai/curate/` (entire route tree)
- `src/routes/api/curate/` (entire endpoint tree)
- `src/lib/curate/engine.ts`
- `src/lib/curate/discovery/` (Tavily / context7 wrappers — duplicated by
  Hermes-native research tools)
- `src/lib/curate/generate.ts`, `live-test.ts`, `promote.ts`
- `src/lib/curate/dev-server.ts`, `port-allocator.ts`, `worktree.ts`,
  `session-store.ts`, `session-lifecycle.ts`, `reaper.ts`, `event-bus.ts`,
  `llm-client.ts`, `materialize.ts`, `prompts/`
- `curate_sessions` table + a new Drizzle migration that drops it

### Move + refactor

- `src/lib/curate/codegen/` → `src/lib/node-builder/codegen/`
- `src/lib/curate/spec/` (NodeSpec types, uiSchema) → `src/lib/node-builder/spec/`
- `src/lib/curate/constants.ts` → fold any still-needed values into
  `src/lib/node-builder/constants.ts`; delete worktree/port constants
- `writeNodeFiles(spec, worktreeDir, srDocsDir)` → drop `worktreeDir`; the
  function writes relative to `process.cwd()`. Code generation runs in the
  same process that serves the SvelteKit dev server, so cwd is always the
  repo root.
- Golden-file tests under `tests/__fixtures__/curate-codegen/` →
  `tests/__fixtures__/node-builder-codegen/`. Apple Calendar fixture stays.

### Keep untouched

- `src/lib/integrations/*` (credentials store, crypto, registry, OAuth refresh)
- `src/routes/api/integrations/*`
- `src/routes/admin/integrations/*`
- Panel widgets used by emitted node panels

## Architecture

**One new Hermes skill** at `~/.hermes-jkai/skills/jkai-node-builder/SKILL.md`.
It is reached only by **yielding** — there is no entry in `_KIND_TO_SKILL` in
`~/.hermes-jkai/extensions/jkai_platform/adapter.py`. The skills that yield
into it are `jkai-canvas` and `jkai-general` (and any future workflow-building
skill).

**Seven new MCP tools** registered in `/api/mcp`, all prefixed `node_builder_`,
all scoped to a single concern. The skill chains them; the chat shows each
call as a normal tool-step panel entry.

### MCP tools

| Tool | Purpose | Returns |
|---|---|---|
| `node_builder_check_clean` | Pre-flight: confirms working tree clean, on `master`, no in-progress merge | `{ ok: true }` or `{ ok: false, reason }` |
| `node_builder_list_existing` | Enumerates registered node types (name, description, integration kind) | array of summaries |
| `node_builder_write_files` | Calls `writeNodeFiles(spec)` from the codegen library; returns paths written | `{ files: string[] }` |
| `node_builder_validate` | Runs `npm run build` and `NODE_OPTIONS=--max-old-space-size=8192 npm run check`; returns success or stderr summary | `{ ok, errors? }` |
| `node_builder_diff` | Returns `git diff --stat` and the full diff for the user to review at the gate | `{ stat, diff }` |
| `node_builder_commit_and_deploy` | The one gated tool: `git add` (codegen-touched paths only), `git commit -m <msg>`, `git push origin master`, `~/strange_rambling_svelte/scripts/deploy.sh`, post-deploy curl verification | `{ ok, deployUrl, log }` |
| `node_builder_abort` | `git checkout .` on codegen-touched paths; deletes any files created since `node_builder_write_files`; restores clean state | `{ ok }` |

Notes:

- `node_builder_write_files` accepts a `NodeSpec` JSON object that matches the
  TypeScript type at `src/lib/node-builder/spec/`. The skill is responsible
  for drafting a valid spec; the tool surfaces shape errors verbatim.
- `node_builder_commit_and_deploy` will **only** stage paths inside the
  codegen-managed allowlist: `src/lib/workflows/nodes/`,
  `src/lib/workflows/registry/`, `src/lib/integrations/adapters/`,
  `sr-docs/content/`, plus `package.json` and `package-lock.json` (codegen
  may add npm deps). Anything outside → refuse. This is a defence in depth
  against the skill being tricked into shipping unrelated changes.
- All tools run in the same process as SvelteKit and use repo cwd. No worktree.

### Data flow

```
User (in jkai-canvas chat)
  └─ "build me a workflow that creates an Apple Calendar event from a
      YouTube video summary"

jkai-canvas
  ├─ workflow_inspect()       ← read current DAG
  ├─ workflow_list_node_types ← discovers `apple_calendar` doesn't exist
  └─ yield → jkai-node-builder
              { gap: "node for Apple Calendar event CRUD via CalDAV" }

jkai-node-builder
  ├─ node_builder_check_clean
  ├─ node_builder_list_existing      ← double-check
  ├─ <research via context7 / web_search>
  ├─ <draft NodeSpec in skill context>
  ├─ node_builder_write_files(spec)
  ├─ node_builder_validate           ← up to 3 retries
  ├─ node_builder_diff
  ├─ APPROVAL GATE  (chat message; user replies "ship")
  ├─ node_builder_commit_and_deploy
  └─ yield ← back to canvas with { node: "apple_calendar" }

jkai-canvas
  └─ resumes the original design with `apple_calendar` available
```

## SKILL.md — `jkai-node-builder`

Stored in the `homeserv-hermes-jkai` repo at
`~/.hermes-jkai/skills/jkai-node-builder/SKILL.md`. Skeleton:

```markdown
---
name: jkai-node-builder
description: "Designs and ships a new jkai workflow node when no existing node fits the user's need."
version: 1.0.0
metadata:
  hermes:
    tags: [jkai, workflow, node, codegen, builder]
    related_skills: [jkai-canvas, jkai-general]
---

# jkai Node Builder

## Identity

You are invoked when another jkai skill (usually `jkai-canvas` or
`jkai-general`) has identified that the workflow they're trying to build
needs a node type that doesn't exist yet. Your one purpose is to design,
generate, validate, and (with John's explicit approval) ship a new node, then
yield back to the caller.

You speak jkai vocabulary (see `jkai-canvas/SKILL.md` § Identity). You do
not invent new fonts, design tokens, or UI patterns — the codegen handles
the panel and emits node UI in the existing design system.

## Operating Procedure — research → spec → write → validate → APPROVAL → ship

1. **Pre-flight.** Call `node_builder_check_clean`. If the tree is dirty or
   off `master`, yield back immediately with `{ ok: false, reason }`. Do not
   try to clean up. The caller decides what to do.

2. **Confirm the gap.** Call `node_builder_list_existing`. If a registered
   node already covers the request, yield back with
   `{ ok: false, reason: "use existing node X" }`.

3. **Research.** Use `context7_resolve_library_id` + `context7_query_docs`
   for library docs. Use web search for service docs. Goal: enough
   understanding to pick the right SDK / library / auth model. Cap research
   to 5 tool calls.

4. **Draft the NodeSpec.** Author a `NodeSpec` JSON object that conforms to
   the TypeScript shape in `src/lib/node-builder/spec/`. Required fields:
   - `name` (snake_case)
   - `displayName`
   - `description`
   - `category`
   - `inputs` / `outputs` schemas
   - `integration` (kind + adapter wiring, if needed)
   - `dependencies` (npm packages added)
   - `uiSchema` (declarative config-panel description)
   - `testCases` (≥ 2; at least one happy-path, one auth/error case)
   Do not present the spec to the user for approval. The user approves the
   *diff*, not the spec.

5. **Write files.** Call `node_builder_write_files` with the NodeSpec.
   Surface any shape errors verbatim and fix the spec.

6. **Validate.** Call `node_builder_validate`. If it fails:
   a. Read the errors.
   b. Either fix the spec and re-write, or hand-patch the affected file via
      `edit`.
   c. Re-validate. Maximum **3** attempts.
   If still broken after 3 attempts → call `node_builder_abort`, then yield
   back with a failure summary.

7. **Present the gate.** Call `node_builder_diff`. Reply to the user:

   > **New node ready: `<name>`** — `<one-line summary>`
   >
   > **Files changed:** *(stat from `git diff --stat`)*
   >
   > **npm deps added:** `<list>` *(or "none")*
   >
   > **Credentials required:** *(if integration kind is new — point to
   > /admin/integrations with the kind name)*
   >
   > **Commit message:** `<one-liner>`
   >
   > **Diff:** *(collapsed by default; expand on request)*
   >
   > Approve commit + push + deploy? Say **ship** / **yes** / **approve**
   > and I'll do it. Say **abort** to roll back.

   Stop. Yield. No `node_builder_commit_and_deploy` on this turn.

8. **On explicit approval** (`ship`/`yes`/`approve`/`go`/`deploy`/👍):
   Call `node_builder_commit_and_deploy` with the message. Surface the
   deploy log. On failure → tell the user the tree is dirty until they
   resolve the failure manually.

9. **Yield back.** Reply with a one-line summary: "Node `apple_calendar`
   is live — resume the canvas build." Yield to the caller skill.

## Hard rules

- Never call `node_builder_commit_and_deploy` without an explicit approval
  signal **in the current turn**.
- Never touch files outside codegen-managed paths. The tool enforces this;
  the skill should too.
- Never run `npm install <package>` directly. The codegen emits a
  `package.json` patch; let `npm run build` resolve it.
- If credentials are needed, point the user to `/admin/integrations` and
  the right `kind`. Do not block the ship — credentials are entered after
  the node is live.
- If the user says "abort" or "no" at the gate, call `node_builder_abort`
  and yield back with `{ ok: false, reason: "user aborted" }`.
```

## Yield wiring — `jkai-canvas` and `jkai-general`

### `jkai-canvas/SKILL.md`

Add a section to the existing **Operating Procedure**:

> **When a needed node type doesn't exist.**
>
> If during the design step `workflow_list_node_types` shows no node that
> fits what John asked for, **stop the design**. Don't fake it with a
> generic `http` or `script` node. Yield to `jkai-node-builder` with a
> one-line gap description (e.g. "build a node for Apple Calendar event
> CRUD via CalDAV"). When control returns with a new node name, resume
> the design with that node now in the catalog.

### `jkai-general/SKILL.md`

Add the same paragraph, adapted: general chat triggers node creation when
the user explicitly asks to build/extend a node, OR when answering the user
would require calling a workflow that needs a missing node.

Neither skill calls `node_builder_*` tools directly. All node-builder MCP
tools are out-of-scope for canvas/general; they're in-scope only for
`jkai-node-builder`. Hermes' skill scoping handles this naturally.

## Approval gate UX

The gate is implemented entirely as SKILL.md prose — step 7 above — and
relies on Hermes' native chat reply / next-turn pattern. There is **no**
custom UI component, **no** SSE event variant, **no** waiter primitive.

The chat will look like a normal Hermes turn: a tool-step panel showing the
preceding tool calls (`check_clean`, `list_existing`, `write_files`,
`validate`, `diff`), then an assistant message with the diff summary and
"ship?" question. The user replies in the chat textbox. Next turn, Hermes
sees the approval and calls `commit_and_deploy`.

This matches the discipline already established in `jkai-canvas` (design →
confirm → apply) and `jkai-general` (build → review → save).

## Error handling

| Situation | Behaviour |
|---|---|
| Working tree dirty before start | Skill aborts; yields back with reason |
| Off master | Same |
| Existing node fits | Skill yields back pointing at the existing node name |
| Research yields no usable SDK | Skill proposes a NodeSpec with `category: "custom-http"` using `fetch` directly; same flow |
| `write_files` fails on shape | Fix the spec, retry once; on second failure abort |
| `validate` fails 3× | `node_builder_abort` runs; skill yields back with the last error summary; user decides next step |
| User says "abort" at the gate | `node_builder_abort` runs; skill yields back with `{ ok: false, reason: "user aborted" }` |
| `git push` fails (e.g. non-ff) | Skill surfaces the error; does NOT auto-rebase; tells user tree state is "committed locally but not pushed" |
| `scripts/deploy.sh` fails | Skill surfaces the deploy log; user fixes manually; the commit is already on origin/master |
| Post-deploy curl verification fails | Skill yields back with "deployed but verification failed; check the VPS" |

## Testing

- **Codegen golden tests** stay (moved to `tests/__fixtures__/node-builder-codegen/`).
  Apple Calendar fixture spec covers the full emission path.
- **MCP tool unit tests** for each `node_builder_*` tool: input validation,
  path-allowlist enforcement (especially for `commit_and_deploy`), shell
  command construction (no injection from NodeSpec name).
- **Skill end-to-end via Hermes CLI**:
  `HERMES_HOME=~/.hermes-jkai hermes -z "build a simple webhook receiver node"`
  → verify the skill is routed to via description, the tool sequence is
  correct, and the approval gate is reached (CLI exits at the gate;
  full ship is manual).
- **Apple Calendar shakedown** stays the acceptance test, now from the
  canvas chat instead of `/jkai/curate`:
  1. Generate iCloud app-specific password
  2. In canvas chat: "build a workflow that creates an iCloud event from
     this text"
  3. Verify canvas yields to node-builder
  4. Verify the gate fires with sensible diff/deps/credentials notes
  5. Reply "ship"
  6. Verify deploy succeeds; canvas resumes with the new node
  7. Add credentials at `/admin/integrations` (kind=basic, Apple ID,
     app-specific password)
  8. Run the workflow

## Phased delivery

Four ship-able phases. Each is small enough to brainstorm-plan-execute in a
single sitting.

### Phase 1 — demolition + codegen rescue
- Delete curate routes/engine/sessions/worktree/etc. per § Demolition
- Move codegen to `src/lib/node-builder/`
- Drop `curate_sessions` table via new Drizzle migration
- Golden tests pass at the new location
- Ship. App still works; no node-builder yet.

### Phase 2 — MCP tools
- Add the seven `node_builder_*` tools to `/api/mcp`
- Unit tests for each
- Verify each tool works standalone via `curl` against `/api/mcp` with
  `HERMES_BRIDGE_SECRET`
- Ship. Tools exist; no skill invokes them.

### Phase 3 — `jkai-node-builder` skill
- Author `~/.hermes-jkai/skills/jkai-node-builder/SKILL.md` per § SKILL.md
  spec
- Commit to `homeserv-hermes-jkai` repo
- `hermes -z "build a simple webhook node"` end-to-end test through the
  approval gate
- Ship. Skill works when invoked directly via description routing.

### Phase 4 — wire canvas + general
- Add the yield paragraph to `jkai-canvas/SKILL.md` and `jkai-general/SKILL.md`
- Commit to `homeserv-hermes-jkai` repo
- Apple Calendar acceptance test from the canvas chat
- Ship.

## Open questions

- **Description-routing reliability for sub-skills.** Phase 1.5 acceptance
  measured 91% first-try routing on top-level skills via CLI sanity tests.
  Yield-routing to a sub-skill is a different code path. Phase 4 acceptance
  should include at least 5 prompts that should yield, and verify routing.
- **Concurrent node builds.** If two chats trigger node-builder at the same
  time, working-tree state collides. The `check_clean` pre-flight catches
  the second one and aborts. Good enough for a single-user system; revisit
  if it becomes a friction point.
- **Rollback after a bad deploy.** Out of scope for this design — relies on
  John reverting manually. Future improvement: `node_builder_rollback` that
  reverts the last commit and re-deploys.
