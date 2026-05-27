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
]);

export function isMetaToolEnabled(): boolean {
  return process.env.JKAI_MCP_META_TOOL === '1';
}
