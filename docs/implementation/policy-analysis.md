# Autonomous policy analysis

The private `/policy-analysis` feature extends the existing Strange Ramblings SvelteKit application. It uses the canonical HealthShell and shared controls, owner authentication, Drizzle/Postgres, workflow queue and lease worker, document extractors, identity matching, graph modal, research provider and model routing. No separate application, public document store or runtime fixture provider is introduced.

## Files and integration points

- `src/lib/policy-analysis/contracts.ts`, `validation.ts`, `prompts.ts`: versioned stage contracts, provenance validation and instructions.
- `pipeline.ts`, `entities.ts`, `models.ts`, `tests.ts`: staged interpretation, conservative identity resolution, eight reusable model patterns and twelve deterministic checks.
- `server/ingest.ts`, `research.ts`, `provider.ts`: bounded extraction, public-source retrieval, routed model calls and private audit/checkpoint records.
- `server/store.ts`, `worker.ts`, `access.ts`: durable state, atomic continuation, cancellation/resume and owner scoping.
- `src/lib/components/policy-analysis/`: structured artefact inspector and adapter to the existing graph modal.
- `src/routes/policy-analysis/`: submission/history and progress/results pages.
- `src/routes/api/policy-analysis/`: private submission, inspection, control and download APIs.
- Existing `src/lib/db/schema.ts`, `src/lib/workflows/{run-queue,run-worker,engine-runtime}.ts`, `src/hooks.server.ts` and `src/lib/nav/site-nav.ts` provide storage, dispatch, lifecycle and navigation integration.
- `scripts/migrations/2026-09-09-policy-analysis.sql` is an additive, repeatable migration matching the canonical Drizzle schema.

## Durable data

Seven new tables: `policy_analyses`, `policy_documents`, `policy_stages`, `policy_executions`, `policy_artefacts`, `policy_provenance` and `policy_model_calls`.

Artefacts are individually addressable rows with indexed analysis/kind and graph endpoints, epistemic origin, confidence, source quotes, offsets, pages/sections and timestamps. Kinds cover passages, claims, mechanisms, assumptions, actors, aliases, resolution candidates, graph nodes/edges, profiles, research questions/sources, evidence, models, tests, scenarios, findings and recommendations. Flexible fields use validated JSONB per kind. Provenance is a separate relation with composite foreign keys preventing links outside an analysis. Original document bytes are bounded, stored privately in Postgres, and downloadable only after an owner check. Submitted entities never enter the shared intelligence graph.

## Routes and APIs

- `GET /policy-analysis`: submit a document or text; list this owner's analyses.
- `GET /policy-analysis/[id]`: progress, final assessment and all supporting artefacts.
- `GET|POST /api/policy-analysis`: list or create a private durable run.
- `GET /api/policy-analysis/[id]`: current stages, artefacts, execution log and model usage metadata.
- `POST /api/policy-analysis/[id]/cancel`: persist cancellation and fence outstanding work.
- `POST /api/policy-analysis/[id]/resume`: retry the first incomplete stage, retaining completed work.
- `GET /api/policy-analysis/[id]/document`: original file as an attachment.
- `GET /api/policy-analysis/[id]/audit?call=[id]`: owner-scoped model input, output and metadata.

All pages and APIs repeat the site's owner access check and scope queries to that owner's email, including on a site with multiple owners. Guests are not granted a new exception. Responses are private/no-store. Mutations check origin and use the existing rate limiter; transactional intake limits an owner to three active analyses.

## Orchestration and restart behaviour

The existing `workflow_runs` queue carries an envelope for one policy stage at a time (`trigger=policy-analysis`). The existing SKIP LOCKED worker claims and renews leases. The web background-service role starts a worker scoped to policy envelopes; a full run-worker can process them too. Each stage persists its output, execution status, timing and the next envelope in one transaction. A stage runs only when the envelope, stage pointer and live lease agree under row locks.

Expired policy leases are requeued by the existing queue sweep. The generic stale-workflow reaper and deployment pause step exclude these envelopes, leaving interrupted policy runs recoverable through lease expiry. Cancellation invalidates the envelope; a delayed response cannot commit after cancellation, lease transfer or resume. Model calls that passed validation can be reused by input hash and prompt version when an interrupted stage retries. Failed calls remain inspectable. Completion requires all eleven stages; extraction/research warnings produce `completed_with_gaps`, not an unqualified completion.

There are three automatic attempts with delayed retries. A stage has a 45-minute wall-time bound, and each model request has a three-minute timeout. Manual resume grants another three attempts while preserving execution history. Completed analyses are immutable; a fresh submission starts a reassessment. No notifications or external messages are sent.

## Providers and trust

Model calls resolve the existing `research-deep` workload and use `getLLMClient`, including the site's configured OpenRouter/Codex routing and usage capture. The actual captured provider/model and token/cost records are retained; unreported cost stays null. Prompt version is `policy-analysis/1.0`. Inputs and outputs are untrusted structured data, never executable plans or tool requests. Malformed JSON, fabricated source quotes, dangling references, invalid confidence and incomplete report/model/scenario coverage fail validation.

Research plans prioritise importance × uncertainty × consequence. At most eight questions each retrieve up to three results using the existing Tavily search/extract client, public URL guard and domain classification. Failures retain available evidence and explicit gaps. Search excerpts are labelled; retrieval time is not confused with publication time or jurisdictional validity. The evidence matrix must evaluate those limits. Sources and model output render as escaped text; URLs come from the retrieval adapter, not model-created citations.

The identity stage uses the site's identity policy. Name-only ambiguity is split into separate candidates instead of silently merged. The graph visual reuses KnowledgeGraphModal; the searchable/focusable relationship list exposes all assertions, including provenance and temporal status. The visual limits itself to 30 connected nodes at a time.

## Verification

Unit tests cover TXT/PDF/DOCX ingestion, upload validation, source boundaries, hostile content, malformed output, confidence, identity ambiguity, graph checks, research failures, URL safety, model/scenario coverage, cancellation, access control and final-report traceability.

Opt-in local integration tests use real Postgres and workflow leases. The browser test submits an uploaded fixture through the real API, closes the browser, advances all eleven stages, then returns to inspect persisted results at desktop and phone widths. It also checks visible failures, cross-owner denial, expired leases, retries and cancellation fencing. Provider integration tests verify real audit persistence and validated-call reuse with synthetic network responses. Fixtures live only under tests; no production fake-provider mode exists.

```sh
TZ=UTC PUBLIC_VAPID_PUBLIC_KEY='' npm run gate
TZ=UTC PUBLIC_VAPID_PUBLIC_KEY='' POLICY_LOCAL_TESTS=1 \
  DATABASE_URL=postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local \
  npx vitest run src/lib/policy-analysis/persistence.integration.test.ts \
  src/lib/policy-analysis/provider.integration.test.ts
```

The browser integration test expects the existing LAN preview (set `POLICY_PREVIEW_ORIGIN`), with its synthetic preview owner. Run these fixture tests while the local policy worker is disabled, so only the test owns the fixture envelopes. `POLICY_KEEP_FIXTURE=1` optionally retains the explicitly synthetic completed browser example for inspection. UTC is the repository's calendar-test baseline; the application still formats dates for the viewer.

## Local preview and limits

The local Compose overlay lives with the operator’s other local stack files, outside this repository. It enables only the policy worker while the preview retains the builder service role, isolated database/credentials/data and loopback binding. The existing LAN gateway supplies preview authentication. See the local stack README for application commands. The canonical production Node entry defaults `BODY_SIZE_LIMIT` to 12 MB before loading adapter-node (preserving an explicit operator override), so 10 MB documents plus multipart metadata can reach the route. This raises the adapter’s default request ceiling sitewide; each endpoint keeps its own validation. A deployment with an explicit smaller ceiling must raise it for larger uploads. Production deployment is left to the repository's existing release workflow; no deployment script was run.

- Input limits: 10 MB, 400 PDF pages, 600,000 extracted characters. DOCX expanded content is bounded at 30 MB. PDFs require readable text; there is no new OCR integration.
- Later model calls reject context beyond 180,000 serialized characters rather than silently dropping evidence. Very large or unusually dense inventories can therefore stop with a visible budget limitation. Finished stages and validated subcalls remain saved.
- Research is bounded, not exhaustive. Retained source text is limited to 10,000 characters per result; source quality is initially a domain heuristic, then assessed in the evidence matrix. Current law, actual powers and jurisdiction are not independently certified by this feature.
- Models and sensitivity analyses are semi-formal and qualitative. Deterministic checks measure graph coverage, not causal proof. Missing relationships are review signals or indeterminate results, never proof that powers or resources do not exist. Confidence is not statistically calibrated.
- The isolated preview has no live provider credentials. Synthetic tests verify behaviour and persistence, not real provider quality, research availability or policy validity. Ordinary preview submissions show a recoverable provider error until a local provider connection is configured through existing site administration.
- No sharing, expert graph editing, numerical payoff simulation, completed-report reruns or export formatting are added in this slice. Original documents and structured artefacts remain available through the private UI/API.

## Validation record (9 September 2026)

- `TZ=UTC PUBLIC_VAPID_PUBLIC_KEY='' DATABASE_URL=<isolated-local-database> npm run gate`: passed. 872 test files passed, one skipped; 10,237 tests passed, three skipped. Type checking reported zero errors; existing repository warnings remain. Production build and client budgets passed.
- The feature's 15 unit tests and five opt-in Postgres/browser integration tests passed, including all eleven stages with synthetic provider output.
- `node scripts/qa/policy-production-preview.mjs`: passed against the actual built application, covering authenticated/guest/anonymous access, cross-owner document privacy, CSRF, no-store, a multipart upload larger than 512 KB and cancellation.
- `node scripts/qa/policy-local-worker-preview.mjs`: passed using the real asynchronous local worker. Ingestion persisted and the run advanced to the model stage; the absent local provider produced an audited error. The synthetic run was then cancelled.
- `npx drizzle-kit export` generated the additive schema statements. The migration was applied with `psql -v ON_ERROR_STOP=1` to the isolated `jkai-db` only.
- `docker compose ... config --quiet`, `docker compose ... up -d jkai`, `git diff --check` and the shared font/navigation/boundary checks passed.

A completed synthetic result is left on the local preview for inspection.
These tests establish implementation behaviour, not live model/research quality.
