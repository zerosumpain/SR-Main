// MCP essentials gate — names of tools that stay visible in `tools/list`
// when the meta-tool dispatcher is enabled (env JKAI_MCP_META_TOOL=1).
//
// Everything else in the registry is reached via `jkai_extended` (see
// ./meta-tool.ts) with list/schema/invoke operations, cutting the manifest
// from ~28k to ~3k tokens. The tools/call dispatch path is unaffected — it
// still looks up tools by name in the full unfiltered registry — so a tool
// name surfaced via jkai_extended.list can also be invoked directly.
//
// Default behaviour (flag absent or != '1'): no filtering. The full registry
// is exposed exactly as before. Flip on the VPS after a smoke test.

export const ESSENTIAL_TOOL_NAMES = new Set<string>([
  // Persistent memory — needed in nearly every turn.
  'save_memory',
  'recall_memories',
  'forget_memory',
  // Scheduling primitive — the user-visible "remind me / follow up at" path.
  'schedule_reply_at',
  // Heartbeat watcher registration — long-running task observability.
  'register_heartbeat_action',
  // Primary outbound notification channel.
  'whatsapp_send',
  // Static-app creation path. jkai-general SKILL.md explicitly tells the
  // model to call this whenever it builds a self-contained HTML app in
  // chat. Routing it through jkai_extended.invoke is fragile (the model
  // sometimes misforms the wrapper args), and the prompt-cost of a single
  // tool definition is modest vs. losing the "build me a quick app" UX.
  'register_hermes_build',
  // New-workflow path. Same rationale: the design-first flow ends with a
  // workflow_build_from_spec call, and the model must reliably hit it
  // after the user confirms. Cheap insurance.
  'workflow_build_from_spec',
]);

export function isMetaToolEnabled(): boolean {
  return process.env.JKAI_MCP_META_TOOL === '1';
}
