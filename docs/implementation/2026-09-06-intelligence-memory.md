# Intelligence and connected memory

Implemented in the cumulative JKAI checkout. Production remains unchanged. Existing provenance-aware memory and the separate Daydream/agent scopes are preserved.

## Identity and extraction

Ingestion, production ingest preview and the resolution sweep share `resolve/policy.ts`. Per-mention candidate retrieval combines names, aliases, identifiers, full-text matches and contextual embeddings. Embedding work happens outside the write transaction; deterministic candidates are refreshed under the identity advisory lock. Contextual similarity alone cannot bind an identity. Names alone cannot merge people; contradictory addresses, numbered variants, cross-type mismatches and competing candidates require review. Human different decisions remain vetoes, including when decision pairs are repointed during a merge.

Extraction prompts contain type definitions instead of an arbitrary whole-note list of existing entities. Structured validation rejects malformed output, duplicate mention IDs and dangling relationships. Literal source spans ground the extracted mentions, and mention IDs distinguish same-name people. Unresolved mentions retain candidates and excerpts for review in Quality. Reviewing a mention replays saved extraction, including relationships, without another model request. Per-source assertions retain conflicting values instead of silently overwriting the entity; Quality provides explicit acceptance or rejection. Extractor confidence no longer grants human confirmation.

Machine adjudication is independent of heuristic scores and requires exact source quotations. Decisions carry hashes of relevant entity/source/relationship evidence: changed evidence reopens machine decisions, while human decisions stay authoritative. Co-mention evidence is restricted to admitted notes. Automatic merging checks historical cluster members, caps each affected pair at 100 source links and 200 relationships, and retains the existing 25-merge nightly cap. Merge/unmerge keeps original memory entity links and resolves canonical identities on read.

## Taxonomy

Type and category operations now include merge, broader, related and selected-member reclassification. The Categories page shows representative members, optional cited semantic assessment, relationship controls and change history. Assessments are advisory and abstain on unverifiable citations. Broader links reject cycles. Merge/reclassification history records exact before/after memberships; undo refuses to overwrite subsequent edits. Type merges retire the old vocabulary entry and resolve that retired name through merge history; category merges retain the original category snapshot for restoration.

Nightly taxonomy cleanup is deliberately bounded: at most five plural type pairs with identical nonempty definitions, no confirmed source entities, at most 20 affected source entities, and no existing dismissal or hierarchy link. Ambiguous taxonomy and source-category merges remain review actions.

## Memory architecture

PostgreSQL remains authoritative, with pgvector semantic search and explicit memory/entity edges. Graphiti was considered: its supported architecture adds a separate graph database and Python service. For this system, keeping memory, corrections, merge history and forgetting within one transactional database avoids a second consistency boundary. No Graphiti dependency or new service is required. Upstream reference: https://github.com/getzep/graphiti.

Personal recall combines lexical, semantic and bounded graph-neighbour retrieval, with pinned core context first and a 3,000-character pin budget. Recall includes provenance, linked entity names and retrieval reason. Temporal validity supports current and historical recall; corrections supersede earlier assertions instead of erasing them. An inference cannot replace an explicit user statement. Daydream/agent records do not leak into personal recall.

The Memory page supports save, correct, pin, validity dates, search, historical recall, entity linking, backfill and Markdown export. Existing memory rows are retained and linked in bounded background batches; ambiguous identities stay unlinked. Markdown is a generated export, not a separately edited source of truth. Chat uses connected personal recall alongside its intelligence context; the recall tool also returns relevant intelligence context. Explicit remember requests no longer take the additional duplicate note-ingestion path.

Forgetting removes memory/entity edges and suppresses the replacement lineage and derived assertions, including historical derived versions. Dependent Daydream themes retire. Automated re-extraction from the same source/category cannot resurrect a forgotten paraphrase. Independently stored source documents and unrelated intelligence assertions are not erased by forgetting a memory.

## Evaluation and rollout

Apply `scripts/migrations/2026-09-06-intelligence-memory.sql` before starting the changed app. This is an additive, transactional, repeatable migration; it does not rebuild the graph or delete existing memories. Backfills are bounded and can be triggered from Memory. All schema changes also exist in the Drizzle schema for new installations.

`node scripts/evaluate-intelligence.mjs` compares the previous heuristic and shared policy on 16 labelled synthetic identity regressions. The recorded baseline has 3 false-positive automatic links; the new policy has zero on this fixture. This is a regression result, not a production precision estimate. `--extraction <predictions.json>` accepts alternative extractor outputs against the included extraction fixture; no model replacement is assumed. Reviewed human decisions capture feature snapshots, export through `/api/jkai/intel/resolution-labels`, and feed `scripts/calibrate-resolution.ts`. Automatic decisions and arbitrary unmerged pairs are not calibration truth.

Local verification covers unit regressions, real PostgreSQL transactions, correction/history/forgetting, idempotent ingestion, evidence invalidation, taxonomy undo/cycle checks and memory link survival across entity merge/unmerge. Browser checks cover desktop/mobile Memory and Categories, Quality, save/pin/export/link/correct/history/forget, mention replay. `scripts/qa/intelligence-memory-preview.mjs` uses the isolated local account and synthetic data only.

Local endpoints and seed/migration commands are in `/home/john/docker/local/README.md`. The builder-role preview intentionally has no live model/integration credentials: extraction accuracy, semantic model recommendations, live-provider latency and unattended nightly operation require connected-provider validation. The fallback paths, policy, persistence and UI are exercised locally; the synthetic benchmark does not establish production model quality.

Authentication retains the existing owner gate and these APIs are not public routes. The local development server has an existing private-address authentication bypass, so local browser checks cannot verify production unauthenticated denial. No authentication bypass was added by this implementation.

## Local validation record

- 975 intelligence/memory unit tests passed (41 files); 19 database tests passed (3 files). Subsequent targeted regressions also passed for forgetting from an older version and merge/unmerge locking.
- Svelte type checking: zero errors (893 existing warnings). Structural route, font, schema-import, module-boundary, source-footprint and text-measure gates passed.
- The migration was applied twice successfully to verify repeatability. The separate synthetic preview seed was also reapplied successfully.
- Desktop and phone browser checks passed for memory controls, graph linkage, correction history, export, forgetting, taxonomy and mention review. The reviewed mention produced the expected `leads` relationship in PostgreSQL.
- The assertion review API accepted a conflicting value and retained the prior value as a superseded assertion; both values were verified in PostgreSQL. Synthetic fixtures were restored to pending review for the user.
- No production build, production deployment, PR or commit was made as part of this batch.
