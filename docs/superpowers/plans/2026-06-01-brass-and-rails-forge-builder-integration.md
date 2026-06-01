# Brass & Rails — Phase 3 Part B: Forge ↔ jkai-builder Integration (STAGED)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.
>
> **STATUS: STAGED / DEFERRED.** Do NOT execute until the two prerequisites are met (see below). Phase 3 "Part A" (the `npm run gate`, `DESIGN.md` guardrails, and the Forge UI shell) is DONE and committed/pushed. This document is Part B — the builder hookup — written now so it's ready to run when unblocked.

**Goal:** Let the Forge drive the existing jkai-builder to autonomously extend `~/brass-and-rails/` on a git branch, gated by `npm run gate`, proposed as a GitHub PR for human merge — reusing the builder with a flagged, low-blast-radius "git-target mode".

## Prerequisites (BLOCKING — verify before starting)
1. **Prod healthy.** As of 2026-06-01 the SvelteKit prod server was crash-looping (`build/handler.js` missing from a broken unrelated deploy). The builder sidecar + a working SvelteKit app are required to test git-target builds end-to-end. Do not start until `strangeramblings.com` is up and the jkai-builder sidecar is running.
2. **GitHub remote.** DONE — `git@github.com:zerosumpain/brass-and-rails.git` (private) exists; the game repo's `master` tracks it; tags pushed. The builder needs push access (the sidecar host already has the `zerosumpain` SSH key per `gh auth status`).

## Architecture (from the code audit, 2026-06-01)
The builder is stable (sidecar migration through Phase 3 of its own plan; no WIP markers in `orchestrator.ts`/`sandbox.ts`). Git-target mode is a flagged ~200-line addition; normal builds untouched.
- Sidecar: `packages/jkai-builder/` (server.ts/rpc.ts) + `src/lib/jkai/{orchestrator.ts,sandbox.ts,executor.ts,builder-client.ts}`; Unix-socket RPC (`/run/jkai-builder/jkai-builder.sock`).
- Workspace model: `/home/jkai/workspace/<id>/{dev,live,snapshots}`, no git; `runTests()` is already a generic "run a shell command, parse exit code" gate; the Phase-2 iteration-approval gate (`requireIterationApproval` → `awaiting_iter_approval` → `approveIteration`/`rejectIteration`) maps onto "gate passed, await human merge".
- Agent runs as `jkai` (Docker) or `johnk` (host mode, `JKAI_BUILDS_HOSTMODE=1`). `~/brass-and-rails` is `john`-owned ⇒ the integration clones a FRESH copy from `origin` into the build workspace (NOT operating on `~/brass-and-rails` in place) — avoids permission issues and is fully isolated.

---

## Task 1: Schema — `gitTargetConfig` on `jkaiBuilds`
- [ ] Add to `src/lib/db/schema.ts` `jkaiBuilds`:
```ts
gitTargetConfig: jsonb('git_target_config').$type<{
  repoUrl: string;        // git@github.com:zerosumpain/brass-and-rails.git
  baseBranch: string;     // 'master'
  branchPrefix: string;   // 'forge/'
  gateCommand: string;    // 'npm run gate'
  openPr: boolean;        // true → open a GitHub PR; false → push branch only
  prTitlePrefix?: string; // 'Forge: '
} | null>().default(null),
```
- [ ] `npx drizzle-kit push` (against the prod DB — only when prod healthy). Verify the column exists; existing builds default to `null` (normal mode) — so nothing changes for non-Forge builds.
- [ ] Commit (svelte repo, schema file only).

## Task 2: Sandbox — `ensureGitWorkspace` + `publishViaGit`
- [ ] `src/lib/jkai/sandbox.ts`: add `ensureGitWorkspace(buildId, cfg)`:
  - `git clone --depth 50 <repoUrl> /home/jkai/workspace/<id>/dev` (fresh, isolated), `cd dev`, `git checkout -b <branchPrefix><id>` off `<baseBranch>`, `npm install`. Return the `dev` path (so the rest of the loop is unchanged).
  - Reuse the existing `execInSandbox` base64 envelope; works in both Docker and host mode.
- [ ] Add `publishViaGit(buildId, cfg, summary)`:
  - In `dev`: `git add -A && git commit -m "<prTitlePrefix><summary>"`, `git push -u origin <branch>`.
  - If `cfg.openPr`: `gh pr create --repo zerosumpain/brass-and-rails --base <baseBranch> --head <branch> --title ... --body <gate report + diff stat + sim deltas>` (the host has `gh` authed as `zerosumpain`). Return the PR URL.
  - Else: return the pushed branch ref.
- [ ] No change to the normal `ensureWorkspace`/`publishBuild`.

## Task 3: Orchestrator — flagged branch-points
- [ ] `src/lib/jkai/orchestrator.ts`:
  - In `initAndPlan`/workspace setup: `if (build.gitTargetConfig) await ensureGitWorkspace(...) else ensureWorkspace(...)`.
  - In `runIteration` test step: `if (build.gitTargetConfig?.gateCommand) run that command as the test` (reuse the `runTests` exit-code path); a non-zero gate = iteration failed (feed the gate report into the next iteration's context, same as the design-lint loop).
  - At completion/publish branch-point: `if (build.gitTargetConfig) await publishViaGit(...)` (and DO NOT auto-merge — set the build to `awaiting_iter_approval` or just `completed` with the PR URL in `serveConfig`/a new field; the human merges on GitHub) `else publishBuild(...)`.
  - Guard everything behind the `gitTargetConfig` presence so normal builds are byte-identical.
- [ ] Add an RPC/`builderClient` passthrough only if a new method is needed (likely not — reuse `startBuild`/`continueBuild` with a build row that carries `gitTargetConfig`).

## Task 4: Scoped API — `/api/jkai/forge`
- [ ] Create `src/routes/api/jkai/forge/propose/+server.ts` (POST): **owner-gated** (`locals.auth()` + `AUTH_ALLOWED_EMAILS`, like `/api/auth/me`). **Hard scope:** reject anything where `repo !== 'brass-and-rails'`. Body `{repo, prompt, trigger}`. Creates a `jkaiBuilds` row with `gitTargetConfig` set (repoUrl/baseBranch/branchPrefix/gateCommand='npm run gate'/openPr=true), `origin:'forge'`, then `builderClient.startBuild(id)`. Returns `{buildId}`.
- [ ] `src/routes/api/jkai/forge/runs/+server.ts` (GET, owner-gated): list Forge builds (origin='forge') with status + PR URL.
- [ ] (Optional) `src/routes/api/jkai/forge/[id]/+server.ts` for a single run's detail/log passthrough.

## Task 5: Wire the Forge page to the API
- [ ] In `~/brass-and-rails/src/forge/`: replace the shell's pending stubs — the "Propose change" button POSTs `/api/jkai/forge/propose`; the runs list polls `/api/jkai/forge/runs` and renders status + PR links; show the live gate report when a run fails.
- [ ] Rebuild + redeploy the game (game repo `dist/` → svelte `static/projects/brass-and-rails/`). **Homeserv-only:** exclude `forge.html` + its `forge-*.js` chunk from the PUBLIC static copy (the Forge needs the homeserv-only builder + owner auth). Serve `forge.html` only on homeserv (e.g. keep it out of the VPS rsync; or gate by host). Game + Lab remain public.

## Task 6: Triggers (scheduled + autonomous)
- [ ] **Scheduled:** reuse the workflow scheduler (`src/lib/workflows/scheduler.ts`, `croner`) — a workflow whose node POSTs `/api/jkai/forge/propose` with a standing directive (e.g. "review analytics, fix the highest-value balance/roster issue"). Register via `workflowSchedules`.
- [ ] **Autonomous:** a committed `~/brass-and-rails/ROADMAP.md` (or `forge/ideas.json`); the propose flow (when trigger='autonomous') picks the top open item as the prompt. The agent may also append discovered issues.
- [ ] Both converge on Task 4's pipeline → branch → gate → PR → human merge (D4: always human review).

## Task 7: End-to-end verification (only with prod healthy)
- [ ] On homeserv, with the sidecar running: POST a real `propose` ("add a tooltip to the end-turn button" — something small + safe). Watch: a `forge/<id>` branch is created in `zerosumpain/brass-and-rails`, the agent iterates, `npm run gate` runs as the gate (fails block the PR), and on success a PR opens with the gate/sim report. Review + merge on GitHub. Confirm a gate-FAILING change (e.g. one that breaks fairness or adds a forbidden font) is NOT proposed.
- [ ] Confirm a normal (non-Forge) jkai build still works unchanged (regression check on the flag isolation).

## Guardrails recap (already enforced by `npm run gate` — Part A, done)
build+lean · sim invariants (no-crash/roster/fairness/economy/perf) · baseline regression · design-lint (fonts/hex/deps/network) · the 6 `DESIGN.md` principles (theme/visual/sealed/lean/gameplay/scope). Always-human-merge (D4) is the backstop.

## Self-review
- Covers spec §6 (git-target mode behind a flag, scoped owner-gated API, triggers, gate-as-merge-gate, guardrails, PR flow, homeserv-only Forge). Part A (gate/DESIGN/Forge-shell) already shipped.
- Blast radius: every builder change is guarded by `gitTargetConfig` presence; normal builds untouched; the schema column defaults null.
- Blocking prereqs stated up top. Cross-repo: Tasks 1-4,6 in svelte repo; Task 5 spans both; commit scoping must continue to avoid the unrelated WIP.
