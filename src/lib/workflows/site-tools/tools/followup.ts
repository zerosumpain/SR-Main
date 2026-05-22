// src/lib/workflows/site-tools/tools/followup.ts
// LLM-callable tool for scheduling ad-hoc follow-ups and checking queue status.

import { register } from '../registry-internal';
import { enqueueFollowUp, cancelFollowUp, getQueueStatus } from '$lib/workflows/chat/followup-queue';
import { db } from '$lib/db';
import { researchSessions, jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

register({
  name: 'followup_schedule',
  description: 'Schedule a follow-up check on a background task. The system will periodically check the task status and message the user when it completes. Use this after starting async operations like research sessions or builds.',
  parameters: {
    type: 'object',
    properties: {
      conversation_id: { type: 'string', description: 'The current conversation ID' },
      task_type: { type: 'string', description: 'Type of task: "research", "build", or "custom"' },
      task_id: { type: 'string', description: 'ID of the task to follow up on' },
      completion_prompt: { type: 'string', description: 'Instructions for what to do when the task completes (e.g. "Summarise the research findings and write a blog draft")' },
      notify_whatsapp: { type: 'boolean', description: 'Whether to also notify via WhatsApp when the task completes' },
      delay_seconds: { type: 'number', description: 'Initial delay before first check in seconds (default: 30)' },
    },
    required: ['conversation_id', 'task_type', 'task_id', 'completion_prompt'],
  },
  category: 'System',
  toolset: 'system',
  handler: async (args) => {
    const taskType = args.task_type as string;
    const taskId = args.task_id as string;
    const conversationId = args.conversation_id as string;
    const completionPrompt = args.completion_prompt as string;
    const notifyWhatsApp = args.notify_whatsapp as boolean ?? false;
    const delaySeconds = args.delay_seconds as number ?? 30;

    // Build check function based on task type
    const checkFn = buildCheckFn(taskType, taskId);
    if (!checkFn) {
      return { success: false, error: `Unknown task type: ${taskType}. Supported: research, build` };
    }

    const id = enqueueFollowUp({
      conversationId,
      taskType,
      taskId,
      checkFn,
      completionPrompt,
      notifyWhatsApp,
      whatsAppNumber: notifyWhatsApp ? '+447359228511' : undefined,
      delayMs: delaySeconds * 1000,
    });

    return {
      success: true,
      data: {
        followUpId: id,
        taskType,
        taskId,
        message: `Follow-up scheduled. I'll check every ~30s and message you when it's done${notifyWhatsApp ? ' (WhatsApp notification enabled)' : ''}.`,
      },
    };
  },
});

register({
  name: 'followup_status',
  description: 'Check the current follow-up queue — see what background tasks are being tracked.',
  parameters: { type: 'object', properties: {} },
  category: 'System',
  toolset: 'system',
  handler: async () => {
    const items = getQueueStatus();
    return { success: true, data: { pending: items.length, items } };
  },
});

register({
  name: 'followup_cancel',
  description: 'Cancel a scheduled follow-up by ID.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Follow-up ID to cancel' },
    },
    required: ['id'],
  },
  category: 'System',
  toolset: 'system',
  handler: async (args) => {
    const cancelled = cancelFollowUp(args.id as string);
    return { success: cancelled, data: { cancelled } };
  },
});

// --- Check function builders ---

function buildCheckFn(taskType: string, taskId: string): (() => Promise<{ done: boolean; result?: unknown; summary?: string }>) | null {
  switch (taskType) {
    case 'research':
      return async () => {
        const [session] = await db.select().from(researchSessions).where(eq(researchSessions.id, taskId)).limit(1);
        if (!session) return { done: true, summary: 'Research session not found — it may have been deleted.' };
        const terminalStatuses = ['complete', 'completed', 'failed', 'cancelled'];
        if (terminalStatuses.includes(session.status)) {
          const reportText = session.report
            ? typeof session.report === 'string' ? session.report : JSON.stringify(session.report)
            : 'No report generated.';
          const truncated = reportText.length > 4000 ? reportText.slice(0, 4000) + '...' : reportText;
          return {
            done: true,
            result: { topic: session.topic, status: session.status },
            summary: `Research "${session.topic}" ${session.status}.\n\nFindings:\n${truncated}`,
          };
        }
        return { done: false, summary: `Still running: ${session.status}` };
      };

    case 'build':
      return async () => {
        const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, taskId)).limit(1);
        if (!build) return { done: true, summary: 'Build not found.' };
        if (build.status === 'completed' || build.status === 'failed' || build.status === 'cancelled') {
          const publishedUrl = build.publishedSlug ? `/projects/${build.publishedSlug}/` : null;
          return {
            done: true,
            result: { title: build.title, status: build.status, url: publishedUrl },
            summary: `Build "${build.title || build.prompt?.slice(0, 50)}" ${build.status}.${publishedUrl ? ` Published at: ${publishedUrl}` : ''}`,
          };
        }
        return { done: false, summary: `Still running: ${build.status}` };
      };

    default:
      return null;
  }
}

// Export buildCheckFn for use by auto-registration in tool handlers
export { buildCheckFn };
