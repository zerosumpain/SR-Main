/**
 * What the reply-code step needs from the tool catalogue, registered at boot
 * (`registerReplyCodeToolRuntime` in `$lib/tools/reply-code-runtime`, called
 * from `src/hooks.server.ts`) so `$lib/integrations` never imports
 * `$lib/tools` back: the tools already import the integrations (Home
 * Assistant, WhatsApp), and the reverse edge was an integrations <-> tools
 * cycle in front of `check-module-boundaries`.
 *
 * Unregistered (a script, a test that does not set it), no call is eligible
 * and nothing runs: a code is never issued, and an open one is declined.
 */
/** The shape of `$lib/tools/invoke-contract`'s ToolTier, restated so this module imports nothing from tools. */
export interface ReplyCodeTier {
  effect: 'read' | 'mutate' | 'destructive';
  confirm: 'never' | 'light' | 'always';
  lane: 'standard' | 'destructive' | 'commission';
}

export interface ReplyCodeToolRuntime {
  /** The per-call tier of `tool` with these arguments, or null when it is not registered. */
  tierOf(tool: string, args: Record<string, unknown>): Promise<ReplyCodeTier | null>;
  /**
   * Run the confirmed call in this process as an unattended WhatsApp
   * principal listing exactly that one tool, so `executeTool` still refuses
   * anything destructive or always-confirm, whatever the gate row says.
   */
  run(tool: string, args: Record<string, unknown>, conversationId: string | undefined): Promise<{ success: boolean; error?: string }>;
}

let runtime: ReplyCodeToolRuntime | null = null;

export function setReplyCodeToolRuntime(next: ReplyCodeToolRuntime | null): void {
  runtime = next;
}

export function replyCodeToolRuntime(): ReplyCodeToolRuntime | null {
  return runtime;
}
