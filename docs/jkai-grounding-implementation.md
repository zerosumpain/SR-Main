# JKAI grounding implementation

Implements the ten recommendations in [the review](jkai-prompts-memory-toolchains-review-2026-09-05.md), in order. The user authorized the build and production deployment. Existing local Sources/news work remains in its original checkouts.

| Item | Delivered behaviour | Main implementation |
| --- | --- | --- |
| 1. Policy | A versioned policy resolves old playbook conflicts; disk compilation prevents stale prompt-cache delivery; turns record prompt identity. | `grounding/policy.ts`, `workflows/prompts/loader.ts` |
| 2. Capability routing | Chat, discovery and MCP share candidate ranking; chat and builder manifests receive active policy descriptions; existing extended aliases survive promotion. | `grounding/capabilities.ts`, `mcp/meta-tool.ts`, tools manifest route |
| 3. Invocation contracts | Discovery includes parameter schemas and destructive flags. The shared execution boundary validates arguments with Ajv before calling a handler and returns field errors plus the schema. | `grounding/schema.ts`, `site-tools/registry.ts` |
| 4. Memory retrieval | Bounded lexical and semantic recall, independent embedding failure fallback, relevance/freshness/confidence ranking, provenance labels and bounded context. Old embeddings backfill incrementally. | `jkai/memory/` |
| 5. Memory and Daydream | Shared transactional writes, explicit replacement IDs, exact-source deduplication, tombstones and derivation invalidation. Notes, rulings and confirmed places link their memory in the same transaction. Personal facts enter Daydream as cited context, while reviewer findings remain inferred and cannot become independent corroboration. | memory service; Daydream snapshot, pack, consolidation, notes, rulings and places |
| 6. Evidence | Successful conversation tools retain full results behind scoped recovery handles; clipping keeps valid JSON and the handle. Knowledge search includes grant-gated activity. Retrieved text is outside the system instruction message. | `grounding/evidence*`, `knowledge/search.ts`, chat assembly |
| 7. Continuity | Cached summaries retain every unsummarized message in the loaded history. Summary refreshes serialize within a worker and retain task, authorization, evidence and pending-work sections. Earlier tool evidence accompanies history. | chat compression/history |
| 8. Execution | Build invocation enforces the advertised capability scope; composed calls inherit context and depth restrictions. Authored JavaScript runs in a resource-bounded bubblewrap process with brokered public reads/platform calls. Missing isolation fails closed. | execution/authored runner, custom tools, tool bridge, release preflight |
| 9. Answer review | Substantial answers receive a task-sized support/coverage check before final text is streamed, with one targeted repair opportunity. Unsupported answers use the verifier's constrained revision or report unresolved gaps. Unavailable verification is recorded as unknown. | `grounding/answer*`, general chat |
| 10. Quality gate | Turns record delivered policy/prompt/capability identity, first calls, validation failures, evidence count and assessment. Efficiency trials need sufficient task-class samples with no material support/completeness regression, as well as call improvement. | `grounding/quality.server.ts`, efficiency trial assessment |

Paths in the table are relative to `src/lib/` unless stated otherwise.

## Operational behaviour and limits

- Schema changes are additive: memory provenance and embeddings, a lexical index, evidence results and answer-quality tables. Existing facts are preserved and legacy origins remain explicitly unverified. The normal CI release schema step applies them.
- Forgetting or correcting a premise invalidates active derived memories recursively. New derived writes cannot reference inactive or expired premises. Historical source records remain audit evidence; this is logical memory forgetting, not a general archival-data erasure feature.
- Daydream consumes personal facts as `contextOnly` cards with memory IDs. Its consolidated finding themes still require active Daydream sources. A user note is stated evidence; a reviewer ruling remains an inference with medium confidence.
- Dynamic handlers require Linux bubblewrap and working namespaces. CI installs the package, and release checks namespace support before changing the running release. The public fetch adapter supports GET/HEAD and JSON/text; authenticated operations compose existing platform tools.
- Quality assessment adds a bounded model call for substantial answers. The verifier is a fallible check, not proof of truth. Brief replies still use the grounding policy. Provider failure does not count as a successful quality assessment.
- Representative routing fixtures establish deterministic resolver behaviour, not measured first-tool accuracy on live user tasks. Quality cohorts need to accumulate before efficiency changes can be accepted. There is no claim that every answer is now correct.
- History continuity covers the loaded window (currently 200 messages) and cached summary. Refresh serialization is process-local. Evidence storage needs a future retention policy if growth becomes material.

## Validation and release

The local preview uses an isolated pgvector database and loopback endpoint `http://127.0.0.1:5275/jkai`; `/api/version` and `/jkai` respond successfully. It has no production data, credentials or Docker socket. Live model/provider behaviour cannot be tested faithfully there. Sandbox execution is checked on the host because the unprivileged preview container cannot create host namespaces.

Validation includes full repository unit tests, Svelte/TypeScript checking, structural/architecture and schema-drift gates, real-database memory rollback/lineage tests, Daydream consolidation boundaries, conversation-scoped evidence recovery, isolated handler timeout/composition, and concurrent execution-context isolation. Production build and deployment run through the repository CI gate, followed by public release SHA verification.
