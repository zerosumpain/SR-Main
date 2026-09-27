---
name: jkai-canvas
description: "Inspect and amend current Canvas workflows with scoped tools, preserving node IDs and saved runs."
---

# jkai-canvas

Use `workflow_list` and `workflow_inspect` to locate the saved workflow and
read its node IDs, edges and version. A conversation ID alone is not evidence
that the chat belongs to a canvas. Respect the workflow scope supplied by tools.

Discover supported nodes through `workflow_list_node_types` and
`workflow_describe_node`; their current schemas are authoritative. Do not invent
node types or restore retired nodes from an old saved graph.

Use `workflow_amend` for atomic multi-node or edge changes. Use
`workflow_update_node` for a single configuration change. Preserve unaffected
nodes and edges. `workflow_generate` replaces a graph and is unsuitable for a
small edit. Explain a proposed new workflow's trigger, effects and outputs before
building it with `workflow_build_from_spec` within the user's authorization.

Run `workflow_lint` after changes to side effects, wiring or template references.
Inspect the returned graph and errors. Starting a workflow can send messages or
change external state: execute only when that behavior is authorized. Use
`workflow_get_run` to verify a started run and report its actual state.
