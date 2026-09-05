# JKAI prompts, memory and extended toolchains: review

Reviewed 5 September 2026. This is a proposal, with no runtime configuration changes.

The system has strong individual components, but its assembled behaviour is inconsistent. The largest improvement would come from making routing, evidence, memory and execution share explicit contracts. More instructions alone will not fix the concrete data-loss and policy-delivery gaps below. The useful target is the shortest **sufficient, grounded** tool chain; a lower call count alone can reward an incomplete answer.

## Scope and evidence limits

Primary checkout: `/home/john/sr-activity-fabric-plan`, HEAD `4479006a`, including existing working-tree Sources changes. Compared core review paths with release commit `ad1fd1d4`: its relevant additions are richer visualisation guidance in `03-tools.md` and model-aware thinking parameters. Neither removes the findings below. This is a source and focused-test review, not a certification of the currently deployed VPS.

Inspected all seven base prompt files, prompt compilation and assembly, skill indexing and the central JKAI general/canvas/research and memory guidance, chat and WhatsApp entry points, MCP essentials and extended dispatch, the builder extension and bridge, memory writers and review, knowledge search and graph context, conversation compression, tool execution and authored handlers, traces, and self-improvement policy trials. The checkout contains 120 SKILL.md files and 170 static `register({` calls in non-test site-tool domain files; those are inventory counts, not claims that every skill or provider handler received a line-by-line audit. Base prompts total 18,118 characters before injected context and tool schemas.

Production memory rows, enabled custom-handler bodies, active database policy versions and live provider credentials were not accessed. Thus memory-content cleanliness, deployed flag settings and actual first-tool success rates remain unmeasured. Historical metrics in source comments were treated as historical explanations, not fresh observations. Local preview data is synthetic and cannot validate those production behaviours.

## Existing strengths to preserve

- Chat, MCP and builder calls share registered handlers.
- MCP supports ranked discovery, compact lists and batch schema retrieval.
- Chat preloads tools and carries recent domains forward; there is an existing regression suite for this.
- Knowledge search already carries file offsets, research URLs and memory identifiers and distinguishes branch errors.
- Destructive-action gates and authored-tool composition restrictions already exist.
- Tool traces, versioned policy overlays and rollback machinery provide useful foundations.
- App, repository-change and Studio builder prompts are separate, reflecting different deliverables.
- The newer activity event contract already distinguishes occurrence from observation and records provenance.

## Ten proposed improvements

### 1. Compile one coherent behavioural policy, with explicit precedence

**Finding.** `07-memory.md` requires recall first for personal factual questions. `general-chat.ts` separately injects an unconditional API-search-first rule for factual/current/numeric questions. `03-tools.md` recommends direct health and home tools and orders workflow creation directly, while `jkai-general/SKILL.md` requires a two-turn design flow. The general skill advertises `jkai_extended.operation="names"`, which the dispatcher rejects. Ephemeral-tool guidance alternates between a user promotion offer and immediate automatic promotion. The general skill also embeds a fixed expected credential count as a health check. These are concrete contradictions and stale operational assertions.

**Change.** Define one versioned policy with precedence: explicit task and retained authorization; execution permissions; task-specific routing; evidence requirements; channel presentation. Generate base instructions and capability guidance from it. Keep routing examples in domain playbooks, but lint their tool names, argument names and supported operations against the registry. Replace fixed inventory claims with runtime capability status. Make automatic prompt compilation compare content hashes and record the effective prompt version per turn, including skill and policy versions.

**Acceptance.** A scenario for current temperature has one unambiguous first action; a workflow request has one authorization policy across prompts and skills; no active playbook names an unsupported meta operation. Inspect the effective prompt, not just files on disk.

**Evidence:** [memory rules](../data/prompts/07-memory.md), [tool guide](../data/prompts/03-tools.md), [problem-solving rules](../data/prompts/06-problem-solving.md), [general skill](../data/skills/jkai-general/SKILL.md), [prompt loader](../src/lib/workflows/prompts/loader.ts), [chat assembly](../src/lib/workflows/chat/general-chat.ts).

### 2. Share a task-aware capability resolver across chat, MCP and builds

**Finding.** Chat selects toolsets using broad regular expressions plus its own always-on list; MCP uses essentials plus policy promotions. The policy overlay is applied in MCP but chat's `getToolsetDefinitions` and `getToolDefinitionsByName` return base descriptions. A policy trial can therefore measure chat whose tool hints never received the tested change. `capabilities_snapshot` returns a static empty tool list. MCP schema/invoke only searches extended tools, so a previously extended name becomes invalid through that wrapper after promotion to essential.

**Change.** Create one resolver returning the chosen capability, canonical arguments, availability, required playbook, and fallback. All transports consume the same descriptors and policy version, while retaining their different permission scopes. Prefer exact requested tools and known domain adapters, then relevant saved integrations, then discovery. Treat regex matches as candidates: rank using task intent, known IDs, previous successful tools and live availability. Return a small set with schemas; preserve stable invocation aliases when visibility changes. Generate capability status from the registry and connection health.

**Acceptance.** Replay temperature, Apple Calendar, PayPal, a named file, general news, and “build it” after a deck discussion. All surfaces resolve the correct domain; changing visibility does not break an existing call; trials record whether the policy was actually delivered.

**Evidence:** [classifier](../src/lib/workflows/site-tools/keyword-classifier.ts), [carry logic](../src/lib/workflows/chat/carried-toolsets.ts), [registry definitions](../src/lib/workflows/site-tools/registry.ts), [MCP server](../src/lib/mcp/server.ts), [extended dispatcher](../src/lib/mcp/meta-tool.ts), [capability snapshot](../src/lib/workflows/site-tools/tools/capabilities.ts).

### 3. Make discovery return usable schemas and validate every invocation

**Finding.** Extended lists include required argument names but omit their types and enum choices, while encouraging callers to skip schema lookup. The shared `executeTool` invokes the handler without central JSON Schema validation. Individual handlers validate inconsistently or cast inputs. The general skill's invalid `names` operation illustrates the first-call cost of descriptive drift.

**Change.** For the best few discovery matches, return compact complete input schemas, including optional arguments that materially affect scope, plus one valid example. Cache by registry/schema version. Validate inputs centrally before executing, after applying an explicit documented alias map. Return structured errors naming the invalid field, expected type and permitted values. Add result schemas for frequently composed tools so `platform.call` consumers know what comes back. Unknown keys should be handled deliberately per schema, not silently ignored by accident.

**Acceptance.** Wrong types, missing identifiers and invalid enums are caught before provider calls; wrapper and direct invocation behave identically; discovery-to-first-valid-call improves without sacrificing argument correctness.

**Evidence:** [meta schema and required-name hints](../src/lib/mcp/meta-tool.ts), [execution boundary](../src/lib/workflows/site-tools/registry.ts), [argument helpers](../src/lib/workflows/site-tools/tool-args.ts). JSON Schema distinguishes property constraints, required fields and additional-property handling: [official object reference](https://json-schema.org/understanding-json-schema/reference/object).

### 4. Retrieve memory by relevance, confidence and freshness

**Finding.** Chat loads active memories newest-first into a 4,000-character content budget. It stops at the first oversized entry, rather than continuing to smaller relevant ones, and renders content without IDs, confidence or dates. Recall and knowledge-memory search use whole-query substring matching. Recent irrelevant facts can displace older important facts, while paraphrased questions can miss them entirely. Procedural patterns share this same budget with personal facts.

**Change.** Keep a small pinned profile, retrieve task-relevant facts separately, and store tool procedures as versioned recipes linked to capabilities. Use lexical plus semantic retrieval and rerank by relevance, confidence, freshness and scope. Include source and validity metadata in a bounded evidence representation. For obvious live-state requests, retrieve useful context during assembly without forcing a visible memory tool round before the authoritative domain call. Never use a remembered current state as a substitute for a current observation.

**Acceptance.** Paraphrases retrieve the intended fact; a burst of unrelated memories cannot evict a pinned preference; a large memory cannot suppress all later entries; stale state is labelled or refreshed.

**Evidence:** [memory assembly](../src/lib/workflows/chat/general-chat.ts), [recall](../src/lib/workflows/site-tools/tools/memory.ts), [unified search](../src/lib/knowledge/search.ts).

### 5. Consolidate memory writes into a provenance-preserving service

**Finding.** `save_memory` supersedes the first same-category fact with enough overlapping words. A synthetic reproduction shows “Mary likes cycling in London” qualifies to supersede “John likes cycling in London”; even “yes”, with zero qualifying words, meets its zero threshold. Superseding the old row and inserting the new row are separate statements. `memory_remember` instead uses exact text deduplication. Background review uses yet another matching rule and advances its review marker on JSON parse failure. Explicit tool writes set confidence high without distinguishing observation from inference; background extraction reads both user and assistant prose.

**Change.** Route every writer through one transactional service. Give facts a subject, predicate, scope, valid time, source message/evidence IDs and observed-versus-inferred status. Prefer explicit replacement by ID; only supersede when identity and contradiction are established. Preserve independent facts and unresolved conflicts. Keep a durable extraction cursor with retryable failures. Make forgetting suppress re-extraction from the same origin, with clear deletion semantics across derived stores.

**Acceptance.** John/Mary facts coexist; short or empty content cannot replace an arbitrary fact; an insert failure leaves the old fact current; an assistant assertion cannot become a user-confirmed fact merely through extraction; retry and forget behaviour are tested.

**Evidence:** [save_memory](../src/lib/workflows/site-tools/tools/memory.ts), [memory_remember](../src/lib/workflows/site-tools/tools/recall.ts), [background review](../src/lib/workflows/chat/memory-review.ts).

### 6. Carry a common evidence envelope from source to answer

**Finding.** Shared tool results have only `success`, `data` and `error`. Knowledge search has useful reference metadata, but injected graph notes drop IDs/URLs and retain title, excerpt and date. Injected personal memory drops confidence and provenance. Chat clips tool-result strings at 32,000 characters; progress results are clipped earlier. The new activity contract has richer provenance but activity is absent from the knowledge search source union.

**Change.** Add an evidence envelope with source ID/URL, source class, retrieved/observed/occurred timestamps, scope, excerpt or value, units, completeness, and next-page/full-result handle. Preserve stable IDs through rendering, summaries and subsequent turns. Integrate activity search through its grants and principal boundaries; expose occurrence and observation separately. Deduplicate derived facts from the same original source before treating them as corroboration. Keep retrieved prose explicitly marked as untrusted source material, separate from governing instructions.

**Acceptance.** Every material externally verifiable claim can point to accessible supporting evidence; a partial result is never presented as a complete count; snapshots cannot establish actions they do not observe; citations can be recovered after context trimming.

**Evidence:** [ToolResult](../src/lib/workflows/site-tools/registry-internal.ts), [knowledge search](../src/lib/knowledge/search.ts), [graph context](../src/lib/jkai/intel/context.ts), [result clipping and pasted URL injection](../src/lib/workflows/chat/general-chat.ts), [activity contract](../src/lib/activity/contracts/event.ts).

### 7. Preserve structured task state and close the compression gap

**Finding.** With a cached summary, `compressHistory` returns only the latest 30 messages. Newly older messages are excluded from both raw context and the cached summary; until eight accumulate, `degraded` and `needsRefresh` remain false. Thus one to seven messages can disappear silently. History loading also returns prose and attachments rather than the tool evidence associated with prior answers. The prompt's “THIS turn” support requirement then encourages re-fetching even when earlier evidence is still valid.

**Change.** Always carry the unsummarised gap verbatim until the summary cursor covers it. Preserve structured objective, accepted constraints, authorization, pending work, resource IDs and evidence references alongside the prose summary. Serialize or version concurrent summary writes to prevent older results overwriting newer coverage. Permit reuse of prior evidence while its freshness and scope remain valid; retrieve its original payload when necessary.

**Acceptance.** Tests at every boundary from one to eight uncovered messages retain corrections and commitments; “continue” resumes the same task with its IDs and evidence; repeated questions reuse valid evidence while refreshing expired observations.

**Evidence:** [compression](../src/lib/workflows/chat/compress.ts), [history loader](../src/lib/workflows/chat/conversation-history.ts), [same-turn rule](../data/prompts/05-rules.md).

### 8. Put execution scope and authored tools behind one enforced boundary

**Finding.** Custom and ephemeral handlers execute `new AsyncFunction` in the application process and receive unrestricted global fetch. A composition guard blocks known destructive registered calls, but cannot mediate raw JavaScript or raw network requests. Promotion/self-improvement has static scanning and smoke checks; initial ephemeral execution and `create_tool` do not run that same verification before execution/registration. Recursion depth is module-global, so unrelated concurrent chains share it. The builder manifest filters enabled toolsets, but its invoke route validates the build token then calls any non-destructive registered name without rechecking that build's enabled toolsets.

**Change.** Pass an invocation context containing principal, build/conversation scope, allowed capabilities, retained authorization, deadline, cancellation and trace parent through all calls. Enforce scope at execution, including nested calls and builder invocations. Run authored handlers in a separately constrained process/container with no application secrets and brokered tool/network access; use per-chain recursion accounting and enforceable resource limits. Apply the same admission lifecycle to create, initial ephemeral execution, promotion and repair. Smoke-test with fixtures where real repeated execution could change state.

**Acceptance.** Hidden out-of-scope builder tools cannot execute by guessed name; parallel chains do not consume each other's recursion allowance; authored code cannot read application environment or reach private endpoints outside grants; timeouts terminate the worker.

**Evidence:** [custom handler loader](../src/lib/workflows/site-tools/custom-tool-loader.ts), [ephemeral tools](../src/lib/workflows/site-tools/tools/ephemeral-tools.ts), [create_tool](../src/lib/workflows/site-tools/meta-tools.ts), [verification](../src/lib/selfimprove/verify.ts), [builder bridge](../src/lib/jkai/tool-bridge.ts), [builder invocation route](../src/routes/api/jkai/tools/invoke/+server.ts). Do not substitute a Node VM context for a security boundary; [Node documentation](https://nodejs.org/api/vm.html) explicitly warns against that use.

### 9. Add a task-sized answer completeness and grounding check

**Finding.** The base rule says “Keep responses concise. This is WhatsApp, not an essay” even though web/canvas chat uses the same base prompt. Its absolute same-turn evidence rule conflicts with the allowance to answer from knowledge. There is no common final claim-to-evidence/completeness check in the chat loop. Research has stronger citation guidance than many other domains. More verbose prose would not by itself improve grounding.

**Change.** Derive an answer contract from the request: a quick state check, explanation, comparison, investigation or reusable report. Return a direct answer, supporting evidence, useful reasoning and material unknowns at the requested depth. For substantial factual answers, track the requested subquestions and ensure each is answered or explicitly unresolved. Verify that cited sources support the actual claim, including units and time scope. Use lightweight deterministic checks first and a bounded verifier only for complex or consequential answers. WhatsApp can receive a concise digest linked to a fuller artifact when appropriate.

**Acceptance.** A status question remains short and sourced; a ten-part review covers all ten parts with evidence; missing data produces a precise limitation rather than fabricated detail; unsupported clauses trigger targeted retrieval or removal.

**Evidence:** [answer rules](../data/prompts/05-rules.md), [research playbook](../data/skills/jkai-research/SKILL.md), [chat loop](../src/lib/workflows/chat/general-chat.ts).

### 10. Evaluate successful grounded answers before optimising call counts

**Finding.** Existing policy trials keep/revert changes using mean tool calls per chat turn. Freshness guards are valuable, but fewer calls can also mean omitted checks, an early refusal or an unsupported answer. Before/after aggregates can differ in task mix. The reviewed tests check important implementation behaviours but do not establish model-level first-tool correctness and answer coverage.

**Change.** Extend the existing trace and trial machinery with a curated scenario set and sampled production evaluations. Record effective prompt/skill/policy/schema/model versions, candidate tools, first useful tool, argument validity, recovery calls, evidence coverage, task completion, freshness, latency and cost. Compare equivalent task classes. Gate rollout on no material regression in grounding/completion, then optimise unnecessary calls and latency. Treat follow-up user corrections as review signals. Include difficult failures: no matches, provider outage, stale memory, contradictory facts, unsupported operations, tool-result injection and compression boundaries.

**Acceptance.** A policy that saves calls by dropping a requested subquestion is rejected. Rollout has a reproducible replay baseline and a canary with rollback. Publish first-useful-tool accuracy separately from discovery calls, and justified pagination separately from redundant repeats.

**Evidence:** [trial assessment](../src/lib/selfimprove/efficiency.ts), [policy record](../src/lib/toolpolicy/policy.ts), [tool trace](../src/lib/jkai/tool-trace.ts).

## Suggested delivery sequence

First establish the evaluation baseline in item 10; fix the concrete contradictions, memory replacement and compression bugs in items 1, 5 and 7. Prioritise item 8's execution boundary before expanding autonomous tool authoring. Then implement shared routing/schema delivery (2–3) and evidence-aware memory/retrieval (4 and 6). Use that evidence foundation to enforce the answer contract in item 9. Keep each stage measurable against the baseline.

## Validation performed

218 existing tests passed across 14 files in two focused Vitest runs. Coverage included keyword classification, carried toolsets, toolchain fixes, composition guards, MCP discovery/dispatch, knowledge search, efficiency trials, prompt cache ordering, builder prompts, the pi extension, ephemeral tools, MCP confirmations and chat confirmations.

A separate in-memory Python probe reproduced the exact word-overlap supersession predicate with synthetic facts; it did not mutate memory. The compression gap and policy delivery mismatch were established by source tracing, not a live production replay. No live model/provider smoke tests were run. No source, prompts, memory records, services or deployments were changed; this report is the only added artifact.
