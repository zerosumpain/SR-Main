# Threat model

## Trust boundaries

Browser requests, policy files, source text, model proposals and client-side approval fields are untrusted. Auth.js validates identity; the existing owner allow-list controls access. API handlers enforce owner access independently of page layouts and development hook bypasses. Every project lookup is owner-scoped; a version must belong to that project.

## Controls

- Cross-origin writes are refused. The existing SvelteKit CSRF protection stays enabled. Private/no-store and noindex/nofollow headers apply to pages, APIs and exports. No share-token path exists.
- Uploaded requests are bounded before parsing. Only PDF, DOCX and UTF-8 TXT are accepted; MIME/extension/signatures are checked. PDF page/text and DOCX declared expanded-size limits reduce parser resource exposure. Extracted text has a total bound. Parser-level vulnerabilities remain an upstream dependency concern; no file is executed.
- Original source text is retained for evidence. A separate input view replaces detected role/instruction directives and flags their locations for review. Prompt framing treats all source and prior model content as data. The LLM has no tools, browsing, code execution or database write capability. Heuristics are not a proof that all malicious prose has been removed.
- Full schema validation, exact quotation checks and reference validation reject invalid proposals. One corrective retry is audited. Model-originated numeric assumptions are rejected. Narrative numeric claims are constrained; explanations are still labelled hypotheses, never authoritative findings.
- User edits cannot forge approval: approval fields are reset server-side. The approval endpoint records identity/time itself and accepts only existing item IDs. Sealing validates inside a locked transaction. Runs revalidate saved snapshots.
- No free-form expression evaluator exists. Simulation steps choose only configured strategy IDs with deterministic rules. Finite/profile/round/sensitivity budgets bound synchronous computation.
- Revision checks reject concurrent draft overwrite. Model snapshots and runs have no mutation API. Historical approved models can still be replayed after a draft changes.
- Shared storage generates safe paths; original filenames do not determine arbitrary paths. Secrets use existing environment/provider handling and are not included in model prompts. Exports contain public/synthetic source material and review audit only.

## Tests

Adversarial tests cover source directives, malformed JSON with one retry, unsupported numeric proposals, missing evidence, unknown actors/payoffs, oversized/unsupported/binary files, stale revisions, cross-origin writes, forged approval fields and direct unapproved API runs. Auth tests reject anonymous and guest sessions even in development. Local browser tests exercise real persistence and export. Production routing and session behaviour must remain covered when auth conventions change.

### Unreviewed first-look output

The first look is bound to the current source hash and stored separately from the candidate model. Saving a new source replaces the first look; snapshot exports retain the report belonging to that saved version. Validate every proposed quotation and supplied location against the original source; reject directive-bearing passages and numerical hypotheses. Invalid model responses receive one corrective attempt, then an explicitly labelled local scan. Source load does not approve or simulate anything. The scan excludes directive-bearing lines, makes no completeness or likelihood claim, and reports uncertainty. Catalogue entries contain links/metadata only and introduce no server-side URL retrieval.
