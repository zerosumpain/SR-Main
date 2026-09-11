# Autonomous policy analysis

The private `/policy-analysis` feature extends the existing Strange Ramblings SvelteKit application. It uses the canonical HealthShell and shared controls, owner authentication, Drizzle/Postgres, workflow queue and lease worker, document extractors, identity matching, graph modal, research provider and model routing. No separate application, public document store or runtime fixture provider is introduced.

## Files and integration points

- `src/lib/policy-analysis/contracts.ts`, `validation.ts`, `prompts.ts`: versioned stage contracts, provenance validation and instructions.
- `pipeline.ts`, `entities.ts`, `models.ts`, `tests.ts`: staged interpretation, conservative identity resolution, ten reusable model patterns and twelve deterministic checks.
- `quotes.ts`, `budget.ts`, `exposure.ts`, `query-guard.ts`, `view.ts`: locating a quotation in extracted text, fitting a call to the context window, ranking an exploitation play, keeping the document out of a search query, and shaping all of it for the dashboard.
- `server/ingest.ts`, `research.ts`, `provider.ts`: bounded extraction, public-source retrieval, routed model calls and private audit/checkpoint records.
- `server/store.ts`, `worker.ts`, `access.ts`: durable state, atomic continuation, cancellation/resume and owner scoping.
- `src/lib/components/policy-analysis/`: the dashboard's sections — verdict, exposure plot, play card, check grid, actor board, evidence mix, cross-policy — plus the structured artefact inspector and the adapter to the existing graph modal.
- `src/routes/policy-analysis/`: submission/history and progress/results pages.
- `src/routes/api/policy-analysis/`: private submission, inspection, control and download APIs.
- Existing `src/lib/db/schema.ts`, `src/lib/workflows/{run-queue,run-worker,engine-runtime}.ts`, `src/hooks.server.ts` and `src/lib/nav/site-nav.ts` provide storage, dispatch, lifecycle and navigation integration.
- `scripts/migrations/2026-09-09-policy-analysis.sql` is an additive, repeatable migration matching the canonical Drizzle schema.

## Durable data

Seven tables: `policy_analyses` (carrying `depth`), `policy_documents`, `policy_stages`, `policy_executions`, `policy_artefacts`, `policy_provenance` and `policy_model_calls`.

Artefacts are individually addressable rows with indexed analysis/kind and graph endpoints, epistemic origin, confidence, source quotes, offsets, pages/sections and timestamps. Kinds cover passages, claims, mechanisms, assumptions, actors, aliases, resolution candidates, graph nodes/edges, profiles, research questions/sources, evidence, models, tests, scenarios, exploitation plays, cross-policy exposures, findings and recommendations. Flexible fields use validated JSONB per kind. Provenance is a separate relation with composite foreign keys preventing links outside an analysis. Original document bytes are bounded, stored privately in Postgres, and downloadable only after an owner check. Submitted entities never enter the shared intelligence graph.

## Routes and APIs

- `GET /policy-analysis`: submit a document or text; list this owner's analyses.
- `GET /policy-analysis/[id]`: the assessment as a dashboard — verdict, exploitation playbook, actors, structural checks, scenarios, evidence, cross-policy exposure, written chapters and run log — with one inspector reaching every artefact's provenance.
- `DELETE /api/policy-analysis/[id]`: remove an analysis, its document bytes and everything under it.
- `GET|POST /api/policy-analysis`: list or create a private durable run.
- `GET /api/policy-analysis/[id]`: current stages, artefacts, execution log and model usage metadata.
- `POST /api/policy-analysis/[id]/cancel`: persist cancellation and fence outstanding work.
- `POST /api/policy-analysis/[id]/resume`: retry the first incomplete stage, retaining completed work.
- `GET /api/policy-analysis/[id]/document`: original file as an attachment.
- `GET /api/policy-analysis/[id]/audit?call=[id]`: owner-scoped model input, output and metadata.

All pages and APIs repeat the site's owner access check and scope queries to that owner's email, including on a site with multiple owners. Guests are not granted a new exception. Responses are private/no-store. Mutations check origin and use the existing rate limiter; transactional intake limits an owner to three active analyses.

## The fourteen stages

Ingestion, decomposition, entity resolution, knowledge graph, actor and incentive
profiles, targeted research, evidence matrix, interaction models, automated policy
tests, adversarial scenarios, **exploitation playbook**, **cross-policy exposure**,
synthesis, **actor persona library**.

`SYNTHESIS_STAGE` and `PERSONA_STAGE` are fixed ordinals, not `STAGES.length - 1`.
Every rule that pins the report is written against synthesis's ordinal, and
deriving one of them from the array's length would move the report's contract onto
the stage that follows it.

The exploitation playbook is the red team. For each profiled actor, using that
actor's own profile, it sets out the concrete plays available to it — preferring
the ones that stay COMPLIANT, because those are the ones a drafter has not priced
— with preconditions, payoff, cost to the objective, early warning, counter-measure
and precedent. The model judges four factors on [0,1] (incentive, ease, impact,
concealment) and the SERVER computes the ranking as their geometric mean, so two
runs over the same judgements rank the same way and the arithmetic is shown on the
page.

Cross-policy exposure compares this assessment against the same owner's other
completed ones, in bounded summary, for weaknesses that exist only because the
policies coexist. The site's identity policy runs across the boundary and supplies
same_body / possibly_same hints; foreign identifiers are recorded in `data`, never
joined, because provenance rows may not cross an analysis.

The persona library is the last stage and it runs AFTER the report, so nothing it
does can cost an assessment that is already written. For each profiled actor it
merges what this run established into the reader's standing dossier on that body,
emitting `persona_link` artefacts; the worker applies them to `policy_personas`
and `policy_persona_observations` inside the same transaction that completes the
stage, under a savepoint, so a failure there is a warning rather than a failed
run. Identity is decided by `assessIdentity` — the site's own policy — and two
equally good matches open a new persona rather than merging two bodies.

A persona is read back at the profile stage and at the red team as CONTEXT, never
as evidence. It is neither a passage nor a retrieved source, so `hasSource` keeps
anything resting on it out of the findings on its own account; where a profile
field is shaped by one anyway it carries the `prior_assessment` origin. A
reader-commissioned research pass over one body appends its own observation with
its sources, through the same retrieval adapter and the same SSRF guard.

`depth` is `standard` or `deep`. Deep widens the research bounds and runs up to
three rounds of enquiry, each planned from what the last round FOUND rather than
from the document again; a round that raises no new question ends it.

## Contract failure is quarantined, not fatal

Every live model response goes through `triageOutput`, which applies the strict
gate's rules per artefact: what fails is dropped and named, its dependants cascade
out with it, and the stage's coverage rules decide whether what survived is an
assessment. Up to two corrective round-trips carry the offending ids and the rule
they broke back to the model, stored as their own audit rows under their own input
hash. A fan-out unit that fails becomes a named gap rather than ending the stage,
until three consecutive failures for the same reason.

Quotations are located rather than matched: PDF line wrapping, hyphenation, smart
punctuation and ligatures are folded for comparison only, and the stored quote is
rewritten to the document's own wording for the span located. A quotation absent
even after folding is still refused.

## Orchestration and restart behaviour

The existing `workflow_runs` queue carries an envelope for one policy stage at a time (`trigger=policy-analysis`). The existing SKIP LOCKED worker claims and renews leases. The web background-service role starts a worker scoped to policy envelopes; a full run-worker can process them too. Each stage persists its output, execution status, timing and the next envelope in one transaction. A stage runs only when the envelope, stage pointer and live lease agree under row locks.

Expired policy leases are requeued by the existing queue sweep. The generic stale-workflow reaper and deployment pause step exclude these envelopes, leaving interrupted policy runs recoverable through lease expiry. Cancellation invalidates the envelope; a delayed response cannot commit after cancellation, lease transfer or resume. Model calls that passed validation can be reused by input hash and prompt version when an interrupted stage retries. Failed calls remain inspectable. Completion requires all thirteen stages; extraction, research and quarantine warnings produce `completed_with_gaps`, not an unqualified completion.

There are three automatic attempts with delayed retries, and an attempt is consumed only where the stage FAILS — an interruption is refunded, bounded by a twelve-execution ceiling, so a deploy during a long analysis costs nothing. A stage's wall clock is sized to its fan-out (20 minutes plus 3 per unit, capped at 6 hours) because stage 1 makes one model call per passage; each model request has a three-minute timeout. Manual resume grants another three attempts while preserving execution history. Completed analyses are immutable; a fresh submission starts a reassessment. No notifications or external messages are sent.

## Providers and trust

Model calls resolve the existing `research-deep` workload and use `getLLMClient`, including the site's configured OpenRouter/Codex routing and usage capture. The actual captured provider/model and token/cost records are retained; unreported cost stays null. Prompt version is `policy-analysis/2.0`. Inputs and outputs are untrusted structured data, never executable plans or tool requests. Malformed JSON, fabricated source quotes, dangling references, invalid confidence and incomplete report/model/scenario coverage fail validation.

Research plans prioritise importance × uncertainty × consequence. At most eight questions each retrieve up to three results using the existing Tavily search/extract client, public URL guard and domain classification. Failures retain available evidence and explicit gaps. Search excerpts are labelled; retrieval time is not confused with publication time or jurisdictional validity. The evidence matrix must evaluate those limits. Sources and model output render as escaped text; URLs come from the retrieval adapter, not model-created citations.

The identity stage uses the site's identity policy. Name-only ambiguity is split into separate candidates instead of silently merged. The graph visual reuses KnowledgeGraphModal; the searchable/focusable relationship list exposes all assertions, including provenance and temporal status. The visual limits itself to 30 connected nodes at a time.

## What is enforced rather than asked for

- Only the retrieval adapter mints a `research_source`. The kind is permitted at
  the research stage so the server's own rows validate, which also let a model
  return a source, and a URL, of its own; model-authored ones are discarded.
- A research query is checked against the document before it is sent. Six
  consecutive words in common means the query is a quotation, and an unpublished
  policy paper does not go into a search provider's logs.
- A call that exceeds the context window has its longest retained text clipped,
  then whole low-value items shed, before anything is refused — and what the model
  did not see is named in the assessment. Items the call exists to read (a
  question's own sources, the actor being profiled) are pinned against both.

## Verification

Unit tests cover TXT/PDF/DOCX ingestion, upload validation, source boundaries, hostile content, malformed output, confidence, identity ambiguity, graph checks, research failures, URL safety, model/scenario coverage, cancellation, access control and final-report traceability.

Opt-in local integration tests use real Postgres and workflow leases. The browser test submits an uploaded fixture through the real API, closes the browser, advances the first eleven stages, then returns to inspect persisted results at desktop and phone widths. It also checks visible failures, cross-owner denial, expired leases, retries and cancellation fencing. Provider integration tests verify real audit persistence and validated-call reuse with synthetic network responses. Fixtures live only under tests; no production fake-provider mode exists.

```sh
TZ=UTC PUBLIC_VAPID_PUBLIC_KEY='' npm run gate
TZ=UTC PUBLIC_VAPID_PUBLIC_KEY='' POLICY_LOCAL_TESTS=1 \
  DATABASE_URL=postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local \
  npx vitest run src/lib/policy-analysis/persistence.integration.test.ts \
  src/lib/policy-analysis/provider.integration.test.ts
```

The browser integration test expects the existing LAN preview (set `POLICY_PREVIEW_ORIGIN`), with its synthetic preview owner. Run these fixture tests while the local policy worker is disabled, so only the test owns the fixture envelopes. `POLICY_KEEP_FIXTURE=1` optionally retains the explicitly synthetic completed browser example for inspection. UTC is the repository's calendar-test baseline; the application still formats dates for the viewer.

## Reading it: four workspaces, and one thing you can run

The dashboard is four workspaces — the verdict, the threat, what it rests on, the
assessment — over the same sections, using the tab primitives the report's five
acts introduced. Every panel stays in the DOM so find-in-page and print reach all
four.

Three of the views are derived rather than read, and none of them calls a model:

- **The stress test** (`stress.ts`) fails an assumption and walks the citations
  the assessment already made. A conclusion resting on it loses its footing; a
  play whose PRECONDITION it was is *disarmed*, because the actor needed it to be
  true. Those are opposite directions and are reported as opposites. The
  deterministic checks are untouched by any of it, which is itself part of the
  answer.
- **The interplay map** (`view.interplay`) draws one arc per play, from the actor
  that would run it to the mechanism or measure it defeats, weighted by that
  play's own exposure.
- **The scenario walk-through** (`view.scenarioBeats`) steps a scenario's recorded
  chain one beat at a time rather than rendering it as a paragraph.

## Sealed runs, and erasure you can state as a fact

A **Sealed** checkbox at submission. `policy_analyses.sealed` is `NOT NULL DEFAULT
false`, so every assessment that ran before this is plainly an unsealed one.

**A DELETE COULD NEVER HAVE GIVEN THIS GUARANTEE.** Anything alive at 02:30 is in
up to fourteen nightly `pg_dump`s under `~/backups/vps-pg` and in the restic
snapshots beside them; deleted tuples sit in heap pages and WAL until vacuum and
checkpoint; and a run's prose reaches OTHER analyses through cross-policy findings
and through the prompts those runs stored. So a sealed run never writes readable
bytes: every free-text column is AES-256-GCM under a per-run key held outside the
database, and purging destroys the key first. Every copy becomes unreadable at
once, wherever it has got to, without anyone having to find it.

- **The key** is 32 bytes at `<POLICY_SEAL_KEY_DIR>/<id>.key`, mode 0600,
  defaulting to `data/policy-keys/`. **Two deployment facts hold this up, and an
  ops change must be read against them:** `data/` is rsynced by ci-deploy
  *without* `--delete`, so a release cannot take the keys of runs in flight; and
  nothing backs that directory up — `backup-vps-db.sh` pulls a database dump and
  nothing else leaves the VPS. **Never add the key directory to a backup set.**
  Losing it makes that run unreadable, which is the intended behaviour and not a
  disaster to recover from: a sealed run is meant to be extracted and destroyed.
- **The id is minted in `createAnalysis`, not by the column default**, so the key
  exists before the first row does. Letting the insert allocate it would mean
  writing the title and context in the clear and encrypting them a statement
  later — and an updated row still leaves its first version in the WAL.
- **The cipher is `$lib/secrets/crypto`'s**, through new `encryptWith` /
  `decryptWith` that take an explicit key. One implementation, two key sources.
- **`SEALED_FIELDS` in `server/seal.ts` is the manifest**, and `seal.test.ts`
  checks it against `schema.ts`: a new free-text column on any of the five tables
  fails that test until it is listed or excused with a reason. A column left in
  the clear breaks nothing and shows nothing, so it is the one thing here that
  cannot be caught by review.
- **Encryption happens at the store seam**, so nothing above it changed:
  `loadArtefacts` and `loadWithMeta` are the only places an artefact is read, and
  the pipeline, the view modules and every component still see plaintext. Values
  carry a `sealed:v1:` prefix, so a row is readable whichever kind of run wrote it.
- **No prompts at all.** `policy_model_calls.input`/`.output` are null on a sealed
  run — not encrypted, absent. The call key, input hash, status, provider, model,
  usage and timings remain, so the run log and the cost still read. Two
  consequences, both stated on the form: the replay diagnostic is unavailable, and
  the model-call **cache cannot hit**, so an interrupted stage re-issues its calls
  rather than replaying them. The cache probe is skipped outright on a sealed run
  — a row with `output: null` would otherwise be a truthy "hit".
- **It never leaves its own blast radius.** No research (a search provider's logs
  are nobody's to delete, and a query says what a paper is about even when it
  quotes nothing); no cross-policy comparison in either direction, enforced both
  in the worker and in `neighbourSummaries`; no persona writes, because the
  library outlives the runs that feed it; no share links.
- **A failure message can quote the paper**, so it is encrypted into the three
  policy tables and a generic line goes to `workflow_runs.error` — that table is
  the whole site's queue, read by surfaces that know nothing about sealing.

### The purge, and its receipt

`purge()` shreds the key **then** deletes. The order is not symmetric: a failed
delete leaves unreadable rows and can be retried, whereas deleting first and
failing to shred would leave ciphertext in fourteen backups with a live key beside
it. `remove()` also now reaches the two things no cascade does — the orphaned
`workflow_runs` envelopes, and any `cross_policy` artefact on another analysis
naming this one, which is prose about the deleted paper stored somewhere else.

Then it **asks**. Eleven probes (`server/census.ts`), one per place a reference can
live, each returning a count that must be zero; `census.test.ts` checks the list
against the schema so a new table fails until it is covered. The receipt names what
a purge cannot reach — the model provider always, and for an unsealed run the
backups and the WAL — and is **downloaded, never stored**: a record of the purge
sitting in the database it emptied would be a new trace of the run. It carries the
id and not the title, for the same reason.

Verified against an isolated Postgres (`sealed.integration.test.ts`,
`POLICY_LOCAL_TESTS=1`): a sealed run's raw rows contain neither the title, the
context, the filename nor any of the document's base64 — while an unsealed run's
contain all four, which is the control that makes the first assertion mean
something — the dashboard reads it back exactly, a sealed run is never offered as
a neighbour, and the purge returns eleven zeroes with the key gone, the queue
envelope deleted and the neighbour's own assessment untouched.

## Taking it away: the offline pack

`?format=bundle` on either export route returns a zip holding `index.html`,
`report.docx`, `report.md`, a `MANIFEST.json` of their digests and a
`README.txt`. The HTML is the **whole dashboard as one standalone file** — the
grids, the drill, the hover cards, the stress lab and the print rules — and it
runs with no network of any kind.

- **Why one file.** A page opened from `file://` has an opaque origin: it cannot
  `fetch` a JSON sibling, and Chrome reports nothing a reader would see. So the
  stylesheet, the fonts (as `data:` URIs) and the compiled script are all inlined,
  and the assessment travels in a `<script type="application/json">` island the
  script reads out of the DOM. `embedJson` escapes `<`, U+2028 and U+2029, so a
  policy paper that quotes the characters of a closing script tag cannot end the
  island mid-assessment.
- **The shell is compiled at deploy time, not per request.** `npm run build:offline`
  (`vite.config.offline.ts`) emits one IIFE and one stylesheet into
  `static/policy-offline/`; the adapter copies that into `build/client/`, which
  ci-deploy rsyncs. Building a pack is then string interpolation plus a zip —
  no headless browser, and the same input gives the same bytes. It is wired into
  `npm run build` and `npm run gate:build` **before** `vite build`, because the
  adapter copies `static/` at that point.
- **It compiles the same components.** The dashboard's dependency graph is
  `$lib/policy-analysis` and `svelte` and nothing else — every component under
  `$lib/components/policy-analysis` takes props and issues no request. If
  `build:offline` starts failing on an unresolved `$app/…`, a component has
  acquired a SvelteKit dependency and the pack is what noticed.
- **The chrome moved for this.** `.pa-band`, `.pa-wrap`, `.pa-seg`, the element
  defaults and the whole `@media print` block were a `:global()` block inside
  `src/routes/policy-analysis/+layout.svelte`. They now live at the end of
  `src/app.css`, because the offline build cannot import a route component (it
  would pull in `HealthShell` and the site nav) and a standalone `.css` import
  from a component breaks `npm run build` with a `swSrc` ENOENT. One definition
  serves both.
- **Fonts travel.** Archivo Black and the variable DM Sans and JetBrains Mono are
  carried as `data:` URIs from `static/fonts/policy-offline/` (87 KB raw). Without
  them `--font-display` falls through to Impact, which is exactly what shipped to
  the live site in August when a `@import` was dropped from the built CSS. The
  variable faces are declared once over their weight range; Google's own
  stylesheet declares 400/500/700 against the same file, which would put the same
  36 KB in the pack three times.
- **Scope.** The owner's pack carries everything, the extracted document included
  — an offline copy is what you take into a room with no network, and a report you
  cannot check against its source is half a report. A pack built from a share link
  is built from the artefacts `resolveShare` already redacted through
  `shareableReport`, and carries no source digest: the hash of an unpublished
  paper is a confirmation oracle.

Measured on the synthetic fixture assessment (1440×1000, Chromium, `offline: true`,
every non-`file://` request recorded): 638 KB for the page, **zero external
requests, zero page errors**, all three faces resolved from their data URIs,
workspace and tab switching live, the drill opening and closing on Escape, and
the hover cards rendering. `pack.test.ts` asserts the same properties on the
zip the endpoint actually returns.

## Local preview and limits

The local Compose overlay lives with the operator’s other local stack files, outside this repository. It enables only the policy worker while the preview retains the builder service role, isolated database/credentials/data and loopback binding. The existing LAN gateway supplies preview authentication. See the local stack README for application commands. The canonical production Node entry defaults `BODY_SIZE_LIMIT` to 12 MB before loading adapter-node (preserving an explicit operator override), so 10 MB documents plus multipart metadata can reach the route. This raises the adapter’s default request ceiling sitewide; each endpoint keeps its own validation. A deployment with an explicit smaller ceiling must raise it for larger uploads. Production deployment is left to the repository's existing release workflow; no deployment script was run.

- Input limits: 10 MB, 400 PDF pages, 600,000 extracted characters. DOCX expanded content is bounded at 30 MB. PDFs require readable text; there is no new OCR integration.
- Later model calls reject context beyond 360,000 serialized characters rather than silently dropping evidence. Very large or unusually dense inventories can therefore stop with a visible budget limitation. Finished stages and validated subcalls remain saved.
- Research is bounded, not exhaustive. Retained source text is limited to 10,000 characters per result; source quality is initially a domain heuristic, then assessed in the evidence matrix. Current law, actual powers and jurisdiction are not independently certified by this feature.
- Models and sensitivity analyses are semi-formal and qualitative. Deterministic checks measure graph coverage, not causal proof. Missing relationships are review signals or indeterminate results, never proof that powers or resources do not exist. Confidence is not statistically calibrated.
- The isolated preview has no live provider credentials. Synthetic tests verify behaviour and persistence, not real provider quality, research availability or policy validity. Ordinary preview submissions show a recoverable provider error until a local provider connection is configured through existing site administration.
- No sharing, expert graph editing, numerical payoff simulation, completed-report reruns or export formatting are added in this slice. Original documents and structured artefacts remain available through the private UI/API.

## Validation record (9 September 2026)

- `TZ=UTC PUBLIC_VAPID_PUBLIC_KEY='' DATABASE_URL=<isolated-local-database> npm run gate`: passed. 872 test files passed, one skipped; 10,237 tests passed, three skipped. Type checking reported zero errors; existing repository warnings remain. Production build and client budgets passed.
- The feature's 15 unit tests and five opt-in Postgres/browser integration tests passed, including every stage with synthetic provider output.
- `node scripts/qa/policy-production-preview.mjs`: passed against the actual built application, covering authenticated/guest/anonymous access, cross-owner document privacy, CSRF, no-store, a multipart upload larger than 512 KB and cancellation.
- `node scripts/qa/policy-local-worker-preview.mjs`: passed using the real asynchronous local worker. Ingestion persisted and the run advanced to the model stage; the absent local provider produced an audited error. The synthetic run was then cancelled.
- `npx drizzle-kit export` generated the additive schema statements. The migration was applied with `psql -v ON_ERROR_STOP=1` to the isolated `jkai-db` only.
- `docker compose ... config --quiet`, `docker compose ... up -d jkai`, `git diff --check` and the shared font/navigation/boundary checks passed.

A completed synthetic result is left on the local preview for inspection.
These tests establish implementation behaviour, not live model/research quality.
