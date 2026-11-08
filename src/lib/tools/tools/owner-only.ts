// The owner-only guard for the private reads (daydream notes, the briefing,
// Today). `executeTool` already refuses a member any tool outside their closed
// list; this is the second wall, in the handler itself, so a tool that is
// one day added to a list by mistake still answers nobody but the owner.

import type { ToolExecContext, ToolResult } from '../registry-internal';

export function refuseUnlessOwner(name: string, ctx?: ToolExecContext): ToolResult | null {
  const who = ctx?.principalId;
  if (who && who !== 'owner') return { success: false, error: `${name} reads the owner's private data and is not available here` };
  return null;
}
