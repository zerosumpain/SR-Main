import { publishJobEvent, createWaiter, getJob } from './job-store';
import { notifyAllSubscribers } from '$lib/server/push';
import { getTool } from '$lib/workflows/site-tools/registry';

/**
 * Whether a tool must ask the user before running. Single source of truth is
 * the `destructive` flag on each ToolDefinition (registry-internal.ts) — set
 * it on the tool, not in a list here. The MCP layer surfaces the same flag to
 * Hermes as `annotations.destructiveHint`.
 */
export function isDestructive(toolName: string): boolean {
  return getTool(toolName)?.destructive === true;
}

/** Short user-facing description of what the tool is about to do. */
export function describeDestructiveAction(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'workflow_delete':          return `Delete workflow "${(args.name as string) ?? args.workflowId ?? 'unknown'}"? This cannot be undone.`;
    case 'workflow_clear_data_store': return `Clear the data store for workflow "${args.workflowId ?? 'unknown'}"? Stored keys will be wiped.`;
    case 'datastore_delete':          return `Delete datastore record ${args.id ? `"${args.id}"` : `key "${args.key ?? 'unknown'}"`} from collection "${args.collection ?? 'unknown'}"? This cannot be undone.`;
    case 'build_delete':             return `Delete build "${args.buildId ?? 'unknown'}"? This cannot be undone.`;
    case 'build_control':            return args.action === 'publish' ? `Publish build "${args.buildId ?? 'unknown'}" to a public /projects page?` : `Run ${String(args.action ?? 'action')} on build "${args.buildId ?? 'unknown'}"?`;
    case 'scraper_script_delete':    return `Delete scraper script "${args.scriptId ?? args.name ?? 'unknown'}"?`;
    case 'scraper_script_save':      return `Save/overwrite scraper script "${args.name ?? args.scriptId ?? 'unknown'}"?`;
    case 'publish_page':             return `Publish page "${(args.slug as string) ?? 'unknown'}" to the public site?`;
    case 'node_builder_commit_and_deploy': return `Commit to origin/master and DEPLOY TO PRODUCTION? This ships live.`;
    case 'gmail_send':               return `Send email to ${(args.to as string) ?? 'unknown recipient'}?`;
    case 'gmail_reply':              return `Send reply on thread ${args.threadId ?? 'unknown'}?`;
    case 'whatsapp_send':            return `Send WhatsApp message to ${(args.to as string) ?? 'default contact'}?`;
    default:                         return `Proceed with ${toolName}?`;
  }
}

/**
 * Emit a confirm event and await the user's decision. Returns true on
 * approval, false on rejection. Rejects (throws) if the job is cancelled
 * while the waiter is pending.
 */
export async function requireConfirmation(
  jobId: string,
  prompt: string,
  details: Record<string, unknown>,
  opts: { destructive?: boolean } = {},
): Promise<boolean> {
  const confirmId = crypto.randomUUID();
  publishJobEvent(jobId, {
    type: 'confirm',
    confirmId,
    prompt,
    destructive: opts.destructive ?? true,
    details,
  });
  try {
    const conversationId = getJob(jobId)?.scope.conversationId ?? null;
    void notifyAllSubscribers({
      title: 'Confirmation needed',
      body: prompt.slice(0, 200),
      url: conversationId ? `/jkai?c=${conversationId}` : '/jkai',
    }).catch((e) => console.warn('[jkai-pwa] approval push failed', e));
  } catch (e) {
    console.warn('[jkai-pwa] approval push failed', e);
  }
  const { awaitResponse } = createWaiter<{ decision: 'approved' | 'rejected' }>(
    jobId,
    `confirm:${confirmId}`,
  );
  const res = await awaitResponse();
  return res.decision === 'approved';
}
