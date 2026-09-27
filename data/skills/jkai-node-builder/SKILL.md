---
name: jkai-node-builder
description: "Extend the supported workflow node catalogue after checking existing capabilities and validating generated code."
---

# jkai-node-builder

Inspect the current node catalogue and existing integrations before proposing
a new node. Prefer an existing node or saved API integration when it covers the
request. Read current tool schemas with `tool_describe` before building.

Specify the node's inputs, outputs, configuration, credentials, external effects
and failure behavior. Credentials must use server-side handles, never embedded
secrets. Implement in the application that owns workflow execution.

Validate generated imports against installed package exports and check the
actual configuration-widget props. Read references/codegen-import-pitfalls.md,
references/third-party-api-pitfalls.md and references/widget-prop-contracts.md
when the change involves those contracts. Run type checks, relevant tests and
the application build. Report only validation that actually completed.

Keep deployment within the user's authorization; making code locally does not
by itself authorize a production release.
