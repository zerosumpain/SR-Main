# One development journey at /jkai/develop, with an autopilot that ships

**Status:** design accepted (self-approved under the `autonomous-build` skill, Full grade).
**Branch:** `feat/develop-journey` from `origin/master` at `94c76442` (the deployed sha).
**Author:** autonomous run, 2026-09-08.

John's brief: *"Currently there's a couple of conflicting UI experiences that are loosely
linked but need a thorough review and proper journey design … combine the experiences into
/jkai/develop as the new journey … deprecate features from /build that don't need to exist
anymore because they're represented better in /develop. But the backlog of previous builds as
well as the publication route to/from /projects is important to keep … I want there to be a
better 'yolo' autonomous build that perhaps uses an adversarial assessment in place of a human
to check success criteria, inject development prompts and guides, with an aim to get to a
successful deployment as quickly as possible … change the links from /build to /develop on
/jkai landing page, menu systems etc."*

---

## 1. What exists, and why the two surfaces conflict

Both surfaces drive the same table. `jkai_builds` holds every build; a build with a
`jkai_build_deliveries` row is a *development feature* and takes a different runtime path at
six branch points (`sandbox.ts:401` broker workspace vs git clone, `orchestrator.ts:1137`
preflight, `:1493` working-preview checkpoint, `:1945` no-PR return, `:2211` no rescue PR,
`executor.ts:610` delivery prompt). The row's existence — not a column — is the lane.

| | `/jkai/builds` | `/jkai/develop` |
|---|---|---|
| Shows | every build, no delivery join | only builds WITH a delivery, capped at 100 |
| Creates | 4 lanes via a 682-line form | 1 lane: SR-Main, `openPr:false` |
| Detail | 5-pane console (`BuildSession`, 989 lines) | 4-tab workspace (`DevelopmentWorkspace`, 700 lines) |
| Ends at | a GitHub PR (`publishViaGit`) | a local batch that nothing pushes |
| Register | `nm-*` admin classes, own page header | DaydreamShell editorial system |

The conflict is not cosmetic. A development feature appears on the legacy list as an ordinary
paused repo build with **Resume** and **Promote** buttons that bypass the develop guards:

- `POST /api/jkai/builds/[id]/resume` → `orchestrator.resumeBuild` (`:246-266`) checks no
  accepted brief, no open decisions and no worker capability, all of which
  `/api/jkai/development/[id]` does check (`:74-78`).
- The list opens `PromoteModal` with `kind: 'app'` for every promotable row
  (`BuildsListV2.svelte:574-579`), so `publishBuild` would copy a full SR-Main clone's `live/`
  into `/projects/<slug>/`. The correct verb for a repo build is the `project-card` path the
  list never reaches.

And a development feature can never read as finished anywhere: it stays `status: 'paused'`
for life, never gets a `publishedSlug`, so the legacy list files it under Paused and the public
landing tile (`/api/landing/vitals`) advertises the builder as *building* indefinitely.

## 2. The journey

One page, one story, five steps — the same five the footer already prints.

```
commission ──▶ brief ──▶ build ──▶ preview ──▶ accept ──▶ release
   (01)        (02)      (03)       (04)        (05)       (06)   ← new
```

### `/jkai/develop` — the portfolio and the archive

`DaydreamShell` as today. The cover keeps the exact headline *What should the site do next?*
(three release-time checks assert that sentence). Changes:

- **Tabs** gain `Shipped` and `Archive`. `developmentLane()` gains a `shipped` lane for a
  delivery whose stage is `pr_open` or `deployed`. `Archive` is not a delivery lane: it swaps
  the page body to the legacy backlog.
- **Deck** becomes five tiles: Waiting on you · In flight · In brief · Accepted · Shipped.
- **01 / Commission** keeps outcome, area and model, and gains one fold,
  *How far it may go on its own*: **where it stops** (Preview only / Open a pull request /
  Ship to production) and **Autopilot** with a round limit. The primary button stays
  *Refine this brief*, which a release-time smoke asserts by name. Thinking level and the
  spend cap were considered for this fold and left out: both are already editable per build
  in the archive console's Controls pane, and neither changes what the journey is.
- **02 / The portfolio** — the ranked rows as today, plus a source mark and, for a shipped
  feature, its pull-request link resolved through `publishedLink()`.
- **03 / The archive** (Archive tab only) — every build without a delivery: sandbox apps,
  studio explainers, forge builds, change requests, chat-registered apps. Outcome facets from
  `bucketOf`, the honest per-lane performance table from `laneStats`, and the row actions that
  must survive: **Promote** / **Edit card** / **Copy link** / **Unpublish** / **Delete** /
  **Open console**. Promote opens `PromoteModal` with the correct `kind` for the row's lane.

### `/jkai/develop/[id]` — the workspace

Four tabs stay (`Brief`, `Build`, `Preview`, `Delivery`); every asserted accessible name is
preserved. `Delivery` grows the release ladder below the batch:

```
accepted into batch → pull request → CI green → merged → deployed sha verified
```

with the PR link, the CI conclusion, and the live `/api/version` sha. An autopilot run shows
its round counter, the last adversarial verdict per criterion, and one **Stop autopilot**
control in the rail.

### `/jkai/builds` — retired to redirect stubs

`/jkai/builds` and `/jkai/builds/new` become `+page.server.ts` redirect stubs (308 →
`/jkai/develop`), the shape `/jkai/knowledge` already uses. Keeping the route in the tree is
deliberate: `tests/lib/nav/nav-parents.test.ts` builds its route set from `+page.svelte` **and**
`+page.server.ts`, so the console's back link still resolves and no hooks change is needed.

`/jkai/builds/[id]` **stays** as the archive console. It is the only viewer for app, studio and
forge builds, the develop workspace links into it for advanced controls and logs, and GitHub
issue comments in the wild point at it.

## 3. Autopilot — an adversary instead of an owner

Today `Continue automatically` (`development-review.server.ts`) asks **the model that wrote the
code** whether its own work meets the criteria, at temperature 0.2, told that *"the owner
prefers autonomous progress"*. It then either accepts into the local batch or resumes the
worker — and only ever when the owner presses the button.

Autopilot replaces the owner with an adversary and closes the loop.

**Who drives it.** The orchestrator, in the builder sidecar. It already bundles the whole
`$lib` graph (`packages/jkai-builder/build.mjs`) and already runs periodic sweeps. A delivery
that pauses with autopilot on is picked up by `autopilotSweep()` on the same timer pattern as
`reapStaleBuilds`, so a web deploy cannot orphan a run.

**The assessment.** A new workload role `development-assessor` in `$lib/models/workloads.ts`
(never a module constant — the registry is the rule). Two calls per round:

1. **Refute.** Each unmet criterion is judged with the stance *default to failed; a criterion
   passes only if the supplied browser evidence or diff shows it*. Every verdict must quote the
   evidence it relies on, the way `design-review.ts` requires — a finding with no visible
   evidence is dropped rather than trusted.
2. **Veto.** Only when round 1 says everything passes: one independent call asked for the
   strongest reason this candidate should *not* ship. A veto with evidence sends the build back
   to work; a veto without evidence is discarded.

Explicit owner verdicts still win (`criterionResult` gives `source: 'owner'` precedence) and
the assessor may not overwrite them.

**The coaching injection.** When criteria fail, autopilot composes one instruction and enqueues
it through `enqueuePendingMessage` — the existing steering channel with receipt states — built
from: the failed criteria and their evidence, the repository lessons for the product area
(`relevantLessons`, ≤8, 90-day expiry), the design-system block already used by the executor,
and the concrete blocker text. Then it restarts the worker.

**Decisions.** If Pi calls `ask_owner`, autopilot answers *only from the accepted brief* —
scope, assumptions, constraints — and must reply `ESCALATE` when the brief does not settle it.
An escalation stops autopilot and leaves the question in the Needs-you lane exactly as today.

**The release.** New module `development-release.server.ts`:

1. Require `acceptedAt`, a passing gate for the exact candidate, and a release policy above
   `preview_only`.
2. Take the candidate's **full** diff against its base from a new broker endpoint `/patch`
   (the existing `/snapshot` and `/inspect` cap at 20k and 40k characters, which is a review
   excerpt, not a release artefact).
3. Clone `origin/master` fresh in the sidecar's host shell, branch `agent/dev-<id8>`, apply the
   patch, commit, push, open the PR through the existing `openPrViaRestApi` with
   `FORGE_GITHUB_TOKEN` (set on the VPS). A conflict stops with the reason; it never forces.
   The candidate's history is a clone of the broker's private batch and shares no ancestor with
   `origin/master`, so pushing that branch directly would present the whole tree as changed —
   applying the diff onto a real master clone is what makes the PR readable.
4. Record the PR url in `published_slug`, stage `pr_open`.
5. Watch: poll the PR for merge, then `/api/version` for the deployed sha. Stage `deployed`
   when the serving sha contains the merge. `pr_open` and `deployed` already exist in
   `DeliveryStage` and have never been reachable.

**What autopilot cannot do.** It cannot merge. CI merges, and only a `tier=low` `agent/` PR
with `AUTOMERGE_TOKEN` set. Anything touching `.github/protected-paths.txt` — auth, secrets,
the deploy path, the agent's own rails — classifies `tier=high` and waits for John. The broker
independently refuses a candidate that edits gate scripts, build config or `package.json`
scripts. Those two are the safety model and neither is being changed.

**Bounds.** Round cap (default 6, max 12), the existing `CHANGE_REQUEST_BUDGET`, the existing
`DEVELOPMENT_LIMITS` per-turn deadlines, and a hard stop on any infrastructure failure. Every
round writes a `jkai_build_delivery_events` row, so the loop is auditable after the fact.

**No schema change.** `jkai_build_deliveries.state` is `jsonb`; autopilot state and the release
record live inside `DeliveryState`. That sidesteps the `drizzle push` release hazard entirely.

## 4. What gets deprecated

| Deprecated | Why it is safe |
|---|---|
| `/jkai/builds` list page (1,180 lines) | Its portfolio, filters, deck, empty states and chrome are all better in develop; its five load-bearing features (lane table, promote, edit card, copy link, unpublish, delete) move to the archive section. |
| `/jkai/builds/new` form (682 lines) | Develop commissions with outcome + area + model. The lane radio, studio evidence mode, four per-hour pacing caps, design-system toggle and plan-first toggle are sandbox/studio-era; site code always wants the design system on, and groom→accept-brief replaced plan approval. |
| Bulk promote from the selection bar | A project card is per-build writing; batch promote was never coherent. Per-row promote stays. |
| Per-row Resume/Restart on the legacy list | It bypassed the develop guards. Start/resume lives in the workspace, where the guards are. |
| `resolveDefaultModel()` in the builds list load | Loaded on every view and never read. |
| `minIterations` in the canvas builder node | Written by two call sites, consumed by none, silently dropped by `sanitiseBuildPatch`. |

**Not deprecated, deliberately:** every non-form creator — `build_create`, `register_chat_build`,
`studio_build`, `request_change`, the canvas `BuilderChatNode`, forge propose and its scheduler,
and selfimprove's change-request lane — plus `POST /api/jkai/builds`, `POST /api/jkai/studio`
(and its service token), the publish/unpublish/project-card endpoints, and the whole
`/jkai/builds/[id]` console with its `/logs` and `/stream` APIs.

## 5. Link changes

| Where | Now | Becomes |
|---|---|---|
| `site-nav.ts` jkai items | `Builds` + `Develop` | one `Develop` cell that also lights under `/jkai/builds` |
| `HubHeader` surfaces | `Builds` · AUTONOMOUS | `Develop` · AUTONOMOUS |
| `JkaiLauncher` ⌘K | `BLD Builds` | `DEV Develop` |
| `ChatArea` landing tile 01 | `/jkai/builds/new` | `/jkai/develop` |
| landing `VitalSigns` BUILDER tile | `/jkai/builds` | `/jkai/develop` |
| codegraph + intel page menus | `Builds` | `Develop` |
| engine-room tour | `/jkai/builds` | `/jkai/develop` |
| orchestrator push notifications | `/jkai/builds/<id>` | `/jkai/develop/<id>` for a delivery build |
| `daydream-improve` heartbeat summary | `→ /jkai/builds` | `→ /jkai/develop` |
| GitHub issue comments (`change-request.ts`) | `/jkai/builds/<id>` | unchanged — change requests are archive-lane builds |

## 6. Verification

- `./scripts/gate-structural.sh` — the seven linters, all dependency-free and all
  run at every gate level. The source footprint is not a constraint here: production sits
  at 611,256 of 910,000 lines, so the 1,862 lines the legacy page gives back are welcome
  but were never needed to make room. Two of the linters fire on deletion specifically:
  `check-font-sizes` hard-codes `src/lib/builds` in its scan scope, and
  `check-module-boundaries` fails on a STALE baseline entry, so `src/lib/builds` must keep
  existing and its `builds <-> canvas` cycle must keep at least one member.
- `npx vitest run` on the touched suites: `build-status`, `lane-stats`, `published-link`,
  `development*`, `nav/site-nav`, `nav/nav-parents`, `nav/nav-coverage`, plus new tests for the
  adversarial parser, the release patch flow and the autopilot state machine.
- `./scripts/gate-remote.sh` for the whole suite on porkserv.
- QA scripts that assert accessible names on develop are updated in the same commit:
  `scripts/ci-verify-development.mjs` and the six `scripts/qa/development-*.mjs`.
- Live: merge to master, confirm `/api/version` reports the new sha, then load `/jkai/develop`
  as the owner and confirm the archive lists past builds and the promote dialog opens.

## 7. Decision log

| Decision | Options considered | Chosen | Why | Reversible? |
|---|---|---|---|---|
| Where the merged list lives | (a) new route, (b) fold into `/jkai/develop`, (c) keep two | **b** | The brief names `/jkai/develop` as the journey. | Yes |
| Legacy backlog placement | (a) mixed into one ranked list, (b) its own tab, (c) separate page | **b** | 84 legacy builds would bury ~6 live features in one list; a tab keeps one page and one story. | Yes |
| `/jkai/builds` retirement | (a) delete routes, (b) 308 stubs, (c) hooks map | **b** | Deleting breaks `nav-parents`; hooks is a protected path needing a human merge. A stub is 6 lines and keeps the route set honest. | Yes |
| The build console | (a) delete, (b) keep for all, (c) redirect delivery builds | **b** | It is the only viewer for app/studio/forge builds and the develop workspace links into it; (c) would loop. | Yes |
| Autopilot driver | (a) orchestrator sweep, (b) heartbeat activity, (c) client timer | **a** | The sidecar owns build state, already bundles the graph and already sweeps; (c) needs the page open. | Yes |
| Assessor model | (a) reuse the build's model, (b) new registry role | **b** | A build marking its own homework is the flaw being fixed; the registry is the house rule for a role needing its own model. | Yes |
| Adversarial shape | (a) single refute pass, (b) refute + veto, (c) 3-vote panel | **b** | A veto only when everything passes is where a false pass actually costs something; a 3-vote panel triples cost per round. | Yes |
| Release mechanism | (a) push the batch branch, (b) apply the diff to a fresh master clone, (c) broker pushes | **b** | The batch shares no ancestor with master, so (a) presents the whole tree as changed; the broker has no network or token, so (c) cannot. | Yes |
| Merge authority | (a) autopilot merges, (b) CI auto-merge on tier=low, (c) always wait for John | **b** | The auto-merge policy and the protected-path tiering already exist and are the reviewed control; adding a second merge path would bypass them. | Yes |
| Release permission | (a) always on, (b) per-feature policy set at commission | **b** | John's own architecture review asks for spend, PR and release to be separate permissions. Default stays `preview_only`, so nothing changes for existing work. | Yes |
| Autopilot state storage | (a) new columns, (b) inside the jsonb state | **b** | No migration, no `drizzle push` release hazard. | Yes |
| Deploy detection | (a) serving sha equals the merge sha, (b) serving sha contains it | **b** | Master moves. Any other merge in the window means equality never holds and the run waits forever. GitHub's compare endpoint answers ancestry directly. | Yes |
| A wedged batch | (a) leave it, (b) a reset endpoint | **b** | Once a released feature merges and deploys, the same change reaches the batch from both directions and the merge can conflict, after which every later candidate fails to prepare with no way to recover. The batch is reproducible, so resetting is honest. | Yes |
| Who answers `ask_owner` | (a) the builder's model, (b) the adversary, (c) always escalate | **b** | The model that raised the question should not settle it. (c) would stop every unattended run on the first design question. | Yes |
