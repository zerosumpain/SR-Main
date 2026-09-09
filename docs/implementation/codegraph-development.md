# CodeGraph development evidence

Implemented in the cumulative JKAI checkout on 9 September 2026. The review is
`docs/reviews/2026-09-09-codegraph-development-review.md`.

Release integration uses master `544b5cd7`, preserving the newer unified
development journey, autopilot and owner-evidence controls. Code context is
mounted in `src/lib/components/builds/DevelopmentWorkspace.svelte`; existing
production footprint budgets and unrelated changes are retained. The release
checkout passed 277 focused tests, including current autopilot/review tests and
the isolated CodeGraph persistence cases. Deployment smoke checks read the new
owner pages and verify anonymous context denial without starting a model.

## Operating surfaces

- `/jkai/develop/:id`: Code context in Brief and Build, with current snapshot,
  relevant files, directional impact, tests, lockfile dependencies, combined-batch
  overlaps, exact recorded context, pins, assessments and saved-source inspection.
- `/jkai/codegraph/ask`: common query presets and advanced CGQL; `uses:path` and
  `used-by:path` distinguish dependency direction. Map starts in 2D; the saved
  3D preference remains available.
- `/jkai/codegraph/sources`: owner-only versioned reference excerpts and indexed
  repository revisions. References include URL, version/commit and licence.
- `/jkai/codegraph/improvement`: duplicate/disputed/changed-evidence review queue
  and policy observations. Proposals do not silently become trusted lessons.
- `/jkai/codegraph/review`: retire, restore or explicitly supersede a lesson;
  supersession requires an active replacement in the same repository and a reason.
- `/jkai/codegraph/serves?build=...`: build-filtered recent retrievals. Historical
  pre/post comparisons are labelled observational rather than causal.

## Evidence and lifecycle

The renderer returns the exact included and omitted lesson/episode IDs and
includes formatting in the hard character budget. Query rows retain the rendered
block, policy version, snapshot/revision, reason and external source IDs. The tool
bridge passes authenticated build/iteration identity to pull retrievals. Skipped,
empty and failed push attempts remain distinguishable.

Structured gate receipts resolve the corresponding iteration under a row lock in
one transaction. Error absence/recurrence is an observed association, not proof
that the context caused the outcome. Preview/provider failures do not train a
negative outcome. Local candidate verification and accepted-batch evidence are
recorded independently of production deployment.

Owner-authored accepted development lessons retain their stable identity and
original evidence in CodeGraph. Existing area lessons are bridged when loaded;
new lessons are bridged on save. Accepted episodes attach to the changed files.
Local acceptance never labels a change as deployed.

An execution context operation has a five-second deadline. Late reads may finish,
but the cancellation signal prevents an expired operation from publishing its
context pack. PostgreSQL snapshot transactions have a statement timeout. Retrieval
failure is visible and the builder continues with workspace inspection.

## Structural indexing

`scripts/lib/codegraph-snapshot.mjs` reads blobs from the named Git commit using
`git cat-file`, not from possibly different working-copy files. It records file
hashes, a manifest hash, imports, conventional test pairings, route paths,
unresolved imports and the versions/licences of imported lockfile dependencies.
Node builtins are excluded from package inventory. Symlinks and runtime crash
dumps are excluded from source snapshots.

The broker attaches a candidate index to each saved snapshot and a batch index to
successful integration. Shared graph liveness is updated only by deployed/owned
indexes. An active pointer selects the current immutable snapshot per scope;
revisiting an old revision does not confuse latest-row ordering. Static edges are
replaced atomically for that repository; historical co-change edges survive.
Snapshot identity includes the index content, so parser fixes or additional SCIP
relationships can enrich the same commit without overwriting its earlier evidence.
Changes to cited hashes create revalidation proposals rather than declaring a
lesson false automatically.

Index a connected owned repository with existing service authentication:

```sh
node scripts/codegraph-tree-pass.mjs --root /path/to/repository --ref COMMIT --repo repository-name --scope owned --dry
CODEGRAPH_URL=https://your-site/api/jkai/codegraph/ingest node scripts/codegraph-tree-pass.mjs --root /path/to/repository --ref COMMIT --repo repository-name --scope owned
```

Set `CODEGRAPH_TOKEN` in the calling environment, never in source or shell history.
The release tree pass uses the same atomic snapshot path. Historical transcript
imports also accept `--root`, `--repo`, `--sessions-dir` and `--memory-dir`.

SCIP is an optional semantic adapter: provide a JSON export from an indexer with
`--scip index.json --scip-ref FULL_COMMIT_SHA`. Only definitions and references to files in the selected tree
are admitted; local symbols do not become cross-file edges. Generate the index
from the same commit being imported. The service never executes imported code.
Syntax-only indexing intentionally reports incomplete coverage. Tree-sitter is not
introduced as a runtime dependency; SCIP supplies the optional semantic boundary
without replacing the existing dependency-free release tool.

External references are explicitly imported excerpts. They are matched to exact
installed package versions or pinned for a build. Broad automatic web crawling,
external account configuration, and running downloaded examples are not enabled.
Repository/query access remains behind the owner/build authentication boundary.

## Evaluation

```sh
node scripts/codegraph-evaluate.mjs tests/fixtures/codegraph/evaluation.json /tmp/codegraph-evaluation.json
```

The seven supplied examples exercise the scoring contract across routes,
components, migrations, integrations, unfamiliar failures, repairs and batches.
They are synthetic and do not measure live retrieval or build improvement.
Use reviewed real observations in the same format for useful comparisons. Each
retrieval observation must carry the snapshot revision, its availability date,
and task date; hindsight snapshots are rejected. Build observations are grouped
by task kind, model, budget and policy; missing metrics stay missing. Supported
outcome metrics include first preview/acceptance time, tokens, cost, repairs,
regressions and investigation actions. Record the observation window and sample
size when comparing policies. Retain policy versions to support rollback.

## Local validation and deployment

Validation on 9 September 2026:

- Full unit suite: 865 files passed, 10,214 tests passed; one file/three tests
  skipped by the existing suite. No unhandled teardown errors remained.
- CodeGraph suite with isolated database integration enabled: 15 files and
  250 tests passed, including the actual build context pack and stored receipt.
- Svelte/TypeScript check: zero errors; 891 existing warnings remain.
- Structural gate passed, including client source footprint, public-route
  boundaries, typography, module boundaries and drift against 196 local tables.
- Worker bundle compiled successfully.
- Production build passed, including a final run of the standard `gate:build`
  with its configured 6 GB heap; all client asset budgets passed. Compose
  configuration was reviewed and validated before restarting the
  isolated web app, builder and broker while no builds were running or queued.
- Desktop (1440 px) and phone (390 px) browser checks passed for source inspection,
  persisted pins, external reference import/provenance and all four tested
  CodeGraph routes. Long source paths retain usable buttons on phone.
- The production bundle, run temporarily against the isolated database, returned
  401 for anonymous context reads and writes. Vite has an existing private-network
  authentication bypass, so the ordinary preview cannot establish that property.

Run the full tests with `TZ=UTC` and without `JKAI_SERVICE_ROLE`; calendar
assertions use the CI timezone and scheduler tests require the default role.
The cumulative suite's deleted-file scanner and asynchronous test teardown were
corrected so those checks complete cleanly. For the production build use
`NODE_OPTIONS=--max-old-space-size=8192 npm run build`, followed by
`npm run gate:client-budgets`, or use the repository's standard `npm run gate:build`;
this full-site checkout exceeds Node's default heap.

Apply the additive migration to the isolated preview database:

```sh
docker compose -f compose.yaml -f compose.jkai.yaml -f compose.development.yaml exec -T jkai-db psql -v ON_ERROR_STOP=1 -U jkai_local -d jkai_local < /home/john/sr-jkai-grounding-work/scripts/migrations/2026-09-09-codegraph-development.sql
```

Focused tests use `JKAI_LOCAL_TESTS=1` and the explicit local database URL. They
cover exact prompt packing, directional impact, locked dependencies, cancellation,
SCIP, evaluation, static-edge replacement, candidate isolation, concurrent receipt
resolution and accepted lesson/episode identity. The browser fixture
`scripts/qa/codegraph-preview.mjs` uses the real isolated broker and database,
checks desktop/mobile and persisted pins, and leaves a paused synthetic example.
It starts no model, accepts no candidate and uses no production data.

The site source-footprint allowance was increased from 611,200 to 612,200 lines
for this authorised feature; duplicated feedback and tree ingestion were replaced.
Crash dumps were added to `.gitignore` and excluded from broker copying after a 6.8 GB
runtime dump prevented reliable local source scanning. The dump was retained.

Real provider-backed build comparisons and production outcome evidence require
subsequent actual builds/releases. Local fixture success is not a claim about
model quality, external provider access or production savings.
