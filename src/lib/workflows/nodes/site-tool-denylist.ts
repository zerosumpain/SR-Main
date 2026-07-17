// Hard denylist for the generic `site-tool` node and the `site-tools` mode of
// `llm-agent`. Tools named here are NEVER invocable from a workflow node,
// regardless of `allowDestructive` or an upstream approval node.
//
// These are the arbitrary-code / self-modification / irreversible-wipe
// surfaces: authoring & promoting ephemeral tools runs LLM-authored JavaScript
// as a tool; the `node_builder_*` family scaffolds, commits, and DEPLOYS new
// canvas node types (i.e. ships code to production); and `workflow_delete` /
// `workflow_clear_data_store` / `build_delete` are unrecoverable data wipes.
// Letting a generated (LLM-authored) workflow reach any of these would turn the
// canvas into an arbitrary-code / self-destruct surface.
//
// NOTE: destructive-but-legitimate tools (whatsapp_send, publish_page,
// blog_create, gmail_send, …) are deliberately NOT here — they are gated by the
// approval-node pattern (config.allowDestructive + an upstream `approval` node),
// not blocked outright. This list is the always-closed escape hatch.
export const SITE_TOOL_DENYLIST: readonly string[] = Object.freeze([
  // Ephemeral / custom-tool authoring — executes LLM-authored JS as a tool.
  'author_ephemeral_tool',
  'promote_ephemeral_tool',
  // Irreversible wipes.
  'workflow_delete',
  'workflow_clear_data_store',
  'build_delete',
  // node_builder_* is also blocked by prefix below (repo-modifying codegen +
  // production deploy). Individual names are intentionally NOT enumerated here
  // so a newly-added node_builder_* tool stays blocked without editing this file.
]);

/**
 * True when a tool is denylisted for workflow-node invocation. Covers the
 * explicit `SITE_TOOL_DENYLIST` plus every `node_builder_*` tool by prefix.
 */
export function isDenylistedTool(name: string): boolean {
  if (name.startsWith('node_builder_')) return true;
  return SITE_TOOL_DENYLIST.includes(name);
}
