// src/lib/workflows/site-tools/platform-guard.ts
//
// What a custom tool's handler may reach through `platform.call`.
//
// The destructive-action gate lives at the MCP dispatcher, and it works: when
// the agent asks to send an email or publish a page, the owner is asked first.
// It sits there deliberately rather than at `executeTool`, because
// `executeTool`'s other callers — the heartbeat, the briefing, the scheduler,
// the nightly improvement run, workflow nodes — are headless by design and
// must keep running with nobody to ask.
//
// But a custom tool's handler calls `executeTool` directly, one floor below the
// dispatcher. So a handler could send mail, publish a page or wipe a data store
// without the gate ever seeing it. That matters more here than it would
// elsewhere for three reasons: the handler is JavaScript the MODEL wrote; the
// nightly toolsmith writes and enables such tools with nobody watching; and the
// model authors them while reading untrusted text — a summarised email, a
// scraped page, a search result. A prompt injection normally costs you one bad
// turn. One that persuades the model to author a tool costs you a permanent
// capability.
//
// There is no way to ask the owner from inside a handler — no conversation, no
// UI, and often no person. So the honest answer is to refuse, and say why. The
// model can still perform the action: it calls the tool ITSELF, where the
// dispatcher's gate applies and the owner gets asked. Nothing becomes
// impossible; it stops being possible *unattended*.
//
// This mirrors `site-tool-denylist.ts`, which closes the same door from the
// workflow-node side. Verified before shipping: of 27 custom tools live in
// production, 18 use `platform.call` and NONE calls a destructive tool.

import type { ToolResult } from './registry-internal';

/**
 * Refuse a destructive tool reached from inside an authored handler.
 *
 * Returns null when the call is fine, or the ToolResult to hand back instead.
 * Fails OPEN on an unknown tool name deliberately: `executeTool` already
 * answers that with "Unknown tool", which is the clearer message, and guessing
 * here would only mask a typo as a permissions problem.
 */
export async function refuseDestructiveCall(
  toolName: string,
  callerName: string,
): Promise<ToolResult | null> {
  const { getTools } = await import('./registry');
  const def = getTools().find((t) => t.name === toolName);
  if (!def?.destructive) return null;

  return {
    success: false,
    error:
      `"${callerName}" may not call "${toolName}" — it has a side effect the owner has to approve, ` +
      `and a stored tool runs with nobody to ask. Call "${toolName}" directly instead: that path ` +
      `prompts for confirmation. If this tool needs to prepare the action, have it return what should ` +
      `happen and let the caller do it.`,
  };
}
