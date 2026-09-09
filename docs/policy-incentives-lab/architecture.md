# Architecture

The module stays within the existing SvelteKit application and shared PostgreSQL database. Schemas in `src/lib/policy-incentives-lab/schemas.ts` are the contract; frontend types are inferred from Zod. JSON Schema for constrained model proposals is generated from those same schemas. No hand-maintained second contract exists.

## Data and execution

`policy_lab_projects` stores resumable draft payloads with a revision counter and owner. `policy_lab_versions` stores immutable snapshots of the source, evidence, model, approvals and proposal audit. `policy_lab_runs` links a version to its configuration, effective parameters, engine version, time, result and canonical hash. Uploaded bytes use the existing file-store seam, while extracted source sections and SHA-256 are stored in the draft and snapshots. The original uploaded-file hash is distinct from the canonical model/result hash.

Every write compares the draft revision to prevent lost updates. Sealing locks the project row, revalidates approvals inside the transaction, allocates a unique version and saves a snapshot. Run requests load an immutable version belonging to the authenticated owner's project and revalidate the complete model. They never execute a client-supplied model. Editing clears draft approvals and cannot alter a version row. No update/delete API exists for snapshots or runs.

The server's submit-style API currently processes synchronously and returns a saved record. Request/config/result boundaries can later be queued without changing deterministic engine inputs. Computation ceilings bound profile count, rounds and sensitivity workload; no job broker is introduced.

## Routes

Pages: `/policy-incentives-lab`, `/policy-incentives-lab/[id]?step=evidence|actors|builder|runner|results|audit`.

API prefix: `/api/policy-incentives-lab/projects`.

- GET/POST root: list/create owner analyses.
- GET `/:id`: draft, versions and runs.
- GET/POST `/:id/sources`; POST `/:id/uploads`: original source and file ingestion.
- GET/POST `/:id/extraction-jobs`: audited synchronous proposals, with task and prompt version.
- GET/POST `/:id/evidence|actors|strategies|assumptions`: inspect/replace a draft collection.
- POST `/:id/model`: replace a validated candidate and clear approvals.
- POST `/:id/approvals`: explicitly approve named item IDs; identity/time come from the server.
- GET `/:id/validation`: missing approvals, values, references and profiles.
- GET/POST `/:id/versions`: list/seal approved snapshots.
- GET/POST `/:id/runs|sensitivity`: list records or calculate from a saved version.
- GET `/:id/reports?run=<id>&format=json|markdown`: authenticated attachment.

Writes include `revision`; runs also include `version_id`. Failures use JSON errors and conventional 400/403/404/409/413/422 statuses. Read/write access requires a real owner session on every handler. Authentication is not inherited solely from a layout.

## LLM boundary

Nine named tasks cover objectives, mechanisms, actors, actor objectives/constraints, strategies, information asymmetries, causal relationships, red-team hypotheses and result explanation. Task prompts are versioned in code and ship with the server bundle. The existing LLM gateway owns provider selection; calls have a timeout and at most one application validation retry. The model receives source data with flagged directives removed, no tools and no browsing. Raw responses, validation errors and model identifiers are persisted.

The LLM may propose null numerical assumptions or retain values already supplied in the model; it cannot originate numeric assumptions. All proposal approvals are reset regardless of model output. Explanations use the saved run's source/model, not a possibly changed draft, and become separately linked annotated records. They never replace calculated values.

D3 positions are presentational only. They never feed simulation calculations or result hashes.
