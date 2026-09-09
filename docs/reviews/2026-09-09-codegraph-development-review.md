# CodeGraph and /jkai/develop capability review

Reviewed 9 September 2026 against the cumulative working tree at `/home/john/sr-jkai-grounding-work` (base HEAD `042719aa`, with existing uncommitted developments).

## Assessment

CodeGraph is a useful foundation for repository intelligence and build memory. It already participates in execution, rather than merely visualising history. Its strongest potential value is reducing repeated investigation, surfacing local implementation patterns, finding relevant tests, and recovering from familiar failures. Its realised effect on build time, cost, and correctness remains unproved by this review: production usage data and a controlled comparison were not inspected.

The next investment should make its evidence current, attributable, and visible within `/jkai/develop`. Expanding the graph before repairing those properties would increase the amount of potentially misleading context.

## What exists

| Capability | Implementation and value | Limit |
| --- | --- | --- |
| Repository graph | File nodes; import, test, co-change, context and gate relationships; liveness and file families | File relationships are not a complete semantic or runtime dependency model |
| Historical memory | Lessons and failure/change episodes, fingerprints, verdicts, citations, retirement and supersession | Historical import scripts are tied to Claude transcripts and machine-specific paths |
| Automatic context | Repo-mode executor queries previous errors, edited/named files, then task topics; renders bounded context | Selection is mostly retrospective and does not directly seed from the complete accepted brief and candidate diff |
| Local examples | Precedent selection finds similar files and reads source from the current build workspace | Useful protection against copying old source, but graph selection can still be stale |
| Agent queries | CGQL through a script/API and `codegraph_query`; the development tool allowlist includes it | The site-tool handler labels calls `chat` without a build identifier |
| Ranking | Recency, verdict, staleness and outcome evidence, including a Wilson lower bound | Better mathematics cannot correct an incorrectly attributed outcome |
| Operator UI | Map, Ask, Review, Relevance and Serves | Separate from the development workspace; default map is 3D and initially shows historical relationships |
| Release integration | Tree pass reads a named Git ref during deployment | Candidate and cumulative unmerged work require their own view |

Primary sources: `src/lib/codegraph/`, `src/lib/jkai/executor.ts`, `src/lib/jkai/development-cycle.ts`, `src/lib/workflows/site-tools/tools/codegraph.ts`, `src/routes/jkai/codegraph/`, `scripts/codegraph-tree-pass.mjs`, and `scripts/codegraph-backfill.mjs`.

## Findings to address first

### 1. Development has two memory systems

`development-state.server.ts:relevantLessons` selects the eight newest unexpired `jkaiBuildLessons` for an area. The development API's `lesson` action writes to that table after acceptance, with candidate revision, evidence and a 90-day expiry. Grooming and execution use these notes. CodeGraph uses separate lesson and episode tables and its own retrieval/ranking. No synchronisation between these paths was found in the reviewed implementation.

Introduce a common evidence identity and ingestion adapter. Preserve the stronger candidate-revision provenance already present in development lessons. Keep local candidate evidence distinguishable from integrated, merged and deployed evidence. Revalidate lessons when their cited implementation or dependency changes; expiry alone is a poor truth test.

### 2. Successful development candidates miss the completion-feedback path

In `orchestrator.ts`, the development branch records a verified candidate, pauses for preview/review, and returns before the later `resolveCompletedBuildServes` hook. Acceptance does not visibly bridge that gap. Next-iteration feedback can still operate, but the last useful retrieval can remain unresolved if no further iteration follows.

Resolve against explicit lifecycle events: gate completed, candidate reviewed, batch integrated, and production verified. Give each event its own meaning. A passed gate is evidence about that gate and revision; it is not proof of user acceptance or production success.

### 3. Counters can describe retrieved content rather than delivered content

The executor records every retrieved lesson/episode ID, whereas `buildContextBlock` may omit entries to meet its character budget. Those omitted entries can receive served and outcome credit. Additionally, the push failure/no-query paths emit logs without necessarily creating query rows, while the Serves dashboard aggregates query rows.

Return a structured rendering result containing the actual included IDs, omitted IDs, text and budget usage. Record attempted, skipped, empty, failed, retrieved and injected states consistently, with build, iteration, revision and channel. Measure actual tokens where possible rather than treating character counts as token counts.

### 4. Outcome attribution is still a proxy

Error disappearance after retrieval does not prove the retrieved guidance caused the repair. All items in a served group currently share the result. `feedback.ts` updates counters and query resolution separately, leaving a retry/concurrency window for duplicate credit. The executor also derives gate success from evaluation text with a regex.

Use structured gate receipts, scope resolution to the relevant iteration/check, and atomically claim and resolve each serve. Label error disappearance as an observed outcome, not causal helpfulness. Keep owner feedback, agent citations, test outcomes and controlled evaluation as distinct signals.

### 5. Freshness is not sufficiently revision-aware

The tree-pass script correctly reads a named ref, but the ingest liveness payload's `ref` is not used in the inspected liveness update; nodes hold a global `existsOnHead` boolean. Static edges are upserted, with no removal/replacement of missing import/test edges found in that path. Two files can remain live after the import connecting them has been removed.

Store repository/ref/SHA and index version in snapshot metadata. Replace static edges for the indexed scope atomically, while preserving historical co-change edges separately. Build a cheap overlay from the accepted batch baseline plus candidate diff, including new, renamed and deleted files. Never let an unmerged candidate overwrite the deployed snapshot's liveness. Replace the hard-coded 1,000-path liveness guard with snapshot completeness checks suitable for smaller external repositories.

### 6. Retrieval is useful context, not yet an impact-analysis contract

The general graph walk expands through both endpoints of selected edges. That is reasonable for discovering context but cannot distinguish dependencies from dependants. Import extraction is regex-based and deliberately excludes bare external packages.

Add explicit questions: “what this uses”, “what uses this”, “which tests cover it”, and “what else changes with it”. Return relationship type, direction, evidence and uncertainty. Missing test edges must mean coverage unknown, not no tests required.

## Integration with the build lifecycle

| Stage | Recommended CodeGraph contribution | Evidence to retain |
| --- | --- | --- |
| Brief grooming | Resolve requested routes/features to implementation; identify reusable components, constraints and previous related work | Why each suggested dependency or scope item was included |
| Before execution | Assemble a small context pack from accepted brief, baseline SHA, candidate changes, applicable lessons and current examples | Query and ranking versions, included IDs, source revisions, budget |
| During execution | Refresh for newly touched files or structured failures; allow focused agent queries | Build/iteration association, latency, misses, agent citations |
| Working preview | Show affected routes and proposed browser checks | Actual preview revision and observed checks |
| Repository verification | Suggest targeted checks early; retain the required full gate before acceptance | Gate command, environment, exit result and revision |
| Batch integration | Identify overlap between accepted developments, shared contracts and combined test requirements | Combined-tree verification; graph overlap is a risk signal, not proof of conflict |
| After acceptance/release | Create evidence-backed episodes and proposed lessons; update applicability after subsequent repairs | Separate local, integrated and deployed outcomes |

This supports the existing bounded build cycle: context should help the first working page arrive sooner and reduce repairs. It should not become another long planning phase. Apply a deadline to the entire context operation, including lookups and bookkeeping; the current `Promise.race` only bounds the principal query and does not cancel underlying work.

## UI recommendations

Make a compact **Code context** section available inside the existing Brief and Build views. Suggested contents:

- Relevant files and existing components, with the reason each matters.
- Likely affected routes, dependants and tests, with evidence type.
- Applicable lessons and previous failures, linked to their source.
- Baseline and candidate revision, indexing time, and explicit partial/stale/unavailable states.
- What the agent actually received, with omitted content and budget visible in details.
- Actions to open source, inspect evidence, pin an item for this build, or flag stale/irrelevant guidance.

Use aligned ruled rows and the existing paper/ink surfaces. Preserve JKAI's typography, code font and application shell. On mobile, use the existing sheet/rail interaction and make the file/evidence list fully usable without the graph.

Keep Map as an exploration option. A build-scoped list and a small directional 2D impact diagram are better defaults for operational decisions than the current full 3D history map. Retain 3D for users who choose it. Include imports and tests in a dedicated impact view rather than silently treating the current historical-edge defaults as impact coverage.

Add plain-language query presets to Ask: “Implement a similar page”, “Investigate this failure”, “Tests for these changes”, and “Risks in this batch”. Retain CGQL as an advanced editor. Link CodeGraph's hub navigation directly to `/jkai/develop`; its current menu points to the older Builds surface.

On Serves, show build-filtered retrievals and an evidence funnel: attempted → injected → cited/used → outcome observed. The current pre/post 17 August comparison mixes time periods, models, task complexity and workflow changes; it is descriptive rather than evidence of causal improvement.

## External code sources

Expand in this order:

1. Other owned repositories and shared packages, scoped by repository and immutable commit.
2. Installed dependencies from lockfiles, including package version, local call sites and official version-relevant documentation.
3. Selected upstream issues, fixes and examples linked to an actual dependency or failure.
4. Broader public examples only for a specific uncovered need.

Every imported item should retain source URL, repository/package identity, commit/version, retrieval date, licence metadata, access scope and evidence status. Treat external code and prose as reference data, never as authority over the accepted brief or build instructions. Execute candidate examples only in the isolated build environment. Search access must follow repository permissions.

Start with lockfile and documentation adapters before bulk source indexing. The existing repository fields and query option are useful foundations, but hard-coded `SR-Main` defaults, machine-specific import paths and snapshot assumptions need removal for reliable multi-repository use.

For later semantic indexing, evaluate [SCIP](https://scip-code.org/), which represents definitions and references, and [Tree-sitter](https://github.com/tree-sitter/tree-sitter), which provides incremental syntax parsing. They address different layers: parsing alone does not establish cross-file symbol identity. For dependency inventory, [GitHub's dependency submission API](https://docs.github.com/en/rest/dependency-graph/dependency-submission) supports dependency snapshots associated with a ref/SHA; it is an inventory integration, not a replacement for code-level relationships.

## Continual improvement and evolution

Create a versioned evaluation corpus from representative tasks: a new route, shared-component change, migration, integration, unfamiliar failure, familiar repair and overlapping batch. Establish relevant files, useful lessons and expected checks by review. Replay against the graph snapshot available before each task to prevent learning from the answer.

Compare ordinary workspace search, current CodeGraph, and revised CodeGraph under comparable model and time budgets. Track:

- Time to first working preview and to accepted candidate.
- Total model cost/tokens and investigation actions.
- Repair iterations and recurring failures.
- Relevant context precision, known-relevant-file recall, stale citations and empty/error rates.
- Context latency and size, split by task type and retrieval lane.
- Integration regressions and later repairs, with sample counts and observation windows.

Review recurring misses and disputed lessons regularly. Automatically propose merges, supersession and revalidation; promote durable lessons only when their evidence supports the claim. Keep policy versions and evaluation results so ranking changes can be compared and rolled back. Do not automatically turn every generated summary into trusted memory.

Recommended delivery sequence:

1. **Trust and measurement:** exact injected IDs, complete query telemetry, atomic feedback and development lifecycle hooks.
2. **Workflow value:** revision-aware candidate context, development lesson adapter and embedded UI.
3. **Structural accuracy:** refreshed static edges, directional queries, route/test/package relationships and combined-batch analysis.
4. **Expansion:** owned repositories, versioned dependencies and measured semantic indexing experiments.

Success is demonstrated when comparable builds reach a correct, accepted candidate with less investigation and repair, without increasing regressions. Node count and graph visual complexity are not success measures.

## Validation and limits

- Ran `PUBLIC_VAPID_PUBLIC_KEY='' npx vitest run src/lib/codegraph`: **13 test files and 241 tests passed**.
- Reviewed source paths for retrieval, rendering, ingestion, feedback, development grooming/execution/review and CodeGraph UI.
- The documented LAN CodeGraph preview returned **HTTP 502**; the loopback develop endpoint was unavailable. No browser layout or live retrieval-quality claim is made.
- Production corpus counts, current ingestion schedules, runtime query usage and realised cost savings were not verified. Historical figures in source comments were not treated as current measurements.
- This is an analysis deliverable. No application code, service configuration or deployment was changed.
