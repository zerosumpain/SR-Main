import { publishJobEvent, createWaiter, getJob } from './job-store';
import { notifyAllSubscribers } from '$lib/server/push';

/** Tool names that must ask the user before running. */
export const DESTRUCTIVE_TOOLS: ReadonlySet<string> = new Set([
  'workflow_delete',
  'build_delete',
  'scraper_script_delete',
  'intel_note_delete',
  'web_app_publish',
  'gmail_send',
  'gmail_reply',
  'whatsapp_send',
]);

export function isDestructive(toolName: string): boolean {
  return DESTRUCTIVE_TOOLS.has(toolName);
}

/** Short user-facing description of what the tool is about to do. */
export function describeDestructiveAction(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'workflow_delete':       return `Delete workflow "${(args.name as string) ?? args.workflowId ?? 'unknown'}"? This cannot be undone.`;
    case 'build_delete':          return `Delete build "${args.buildId ?? 'unknown'}"? This cannot be undone.`;
    case 'scraper_script_delete': return `Delete scraper script "${args.scriptId ?? args.name ?? 'unknown'}"?`;
    case 'intel_note_delete':     return `Delete intel note "${args.noteId ?? 'unknown'}"? This cannot be undone.`;
    case 'web_app_publish':       return `Publish web app "${(args.slug as string) ?? 'unknown'}" to the public URL?`;
    case 'gmail_send':            return `Send email to ${(args.to as string) ?? 'unknown recipient'}?`;
    case 'gmail_reply':           return `Send reply on thread ${args.threadId ?? 'unknown'}?`;
    case 'whatsapp_send':         return `Send WhatsApp message to ${(args.to as string) ?? 'default contact'}?`;
    default:                      return `Proceed with ${toolName}?`;
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
