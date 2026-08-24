# Harness capability audits

Use this when reviewing or hardening the tool surface exposed to `/jkai` or another plugin-backed channel.

## Audit the effective capability set

Do not infer exposure from the channel adapter alone. Trace all layers:

1. Global toolsets in the active profile configuration.
2. Per-platform `platform_toolsets` resolution.
3. Plugin-platform registration and fallback naming.
4. Core/composite toolset expansion.
5. MCP server injection, which may be independent of built-in toolset filtering.
6. Delegated-worker inheritance of MCP and built-in toolsets.
7. Approval policy: distinguish preventing execution from merely allowing creation.

A written instruction such as “do not use local files” is not capability isolation if file or shell tools remain in the effective manifest. Prefer an explicit per-surface allowlist, with sensitive capabilities available only in dedicated development/build contexts.

## Plugin-platform fallback pitfall

A plugin platform that is absent from the static platform registry may synthesize a platform toolset name that does not exist. Resolution can then fall back to the global toolsets and accidentally expose the full core bundle. Verify the actual gateway resolution path, not just the profile YAML.

Use two layers where practical:

- an explicit `platform_toolsets.<platform>` allowlist as the primary control;
- a named composite toolset as a defensive fallback.

Add a test asserting both allowed and forbidden tool names in the final manifest. Test through the channel adapter or gateway boundary, not only the toolset helper.

## MCP bypass check

MCP tools can be injected separately from built-in toolsets. Restricting `terminal`, `file`, or `cronjob` does not prove the surface is least-privilege if an MCP server exposes equivalent write/execute actions. Audit MCP manifests, per-tool bridgeability, and delegated-worker inheritance separately.

## Contract-drift checks

For meta-tools with operations such as `list`, `schema`, `invoke`, and `names`:

- derive runtime dispatch and advertised enums from one source of truth;
- invoke every advertised operation with a minimal valid request in a contract test;
- assert every implemented operation is advertised;
- test success and error envelopes;
- ensure results require one JSON parse at the MCP text boundary, not nested string parsing.

A schema visible to the model can differ from the production implementation. A live minimal probe is part of the audit.

## Mutation and lifecycle truth

Prefer additive metadata so existing consumers continue to work:

- `environment`, `resourceType`, `resourceId`, `changed`;
- lifecycle states that distinguish `accepted`, `applied`, `verified`, and `live`;
- a common operation handle alongside existing `buildId`, `runId`, or `jobId` fields;
- audit and reversal information where genuinely supported.

Never report `live` from a push alone. Require CI and public-endpoint evidence.

## Deployment invariant

Search registered tool implementations and tests for direct deployment commands. Site tools must not invoke `scripts/deploy.sh`; pushing to `master` triggers CI. Add a contract test prohibiting the command string in registered tool implementations so stale helper names cannot reintroduce it.

## Change-request confirmation gate

`request_change` can reject an invocation as unattended even when the user approved the overall project in an earlier message. Treat the gate result as authoritative:

1. Do not retry automatically.
2. Preserve the prepared specification.
3. Tell the user the write gate needs a fresh explicit confirmation.
4. Re-submit only after that confirmation arrives.
5. Keep audit/discovery work marked complete; describe implementation as blocked rather than running.
