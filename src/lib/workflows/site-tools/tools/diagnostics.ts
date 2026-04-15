import { register } from '../registry-internal';
import { db } from '$lib/db';
import { workflowSchedules, workflows, workflowRuns } from '$lib/db/schema';
import { desc, eq, and } from 'drizzle-orm';
import { formatTimestamp } from '../format-time';

// ==========================================
// Scheduler Diagnostics
// ==========================================

register({
  name: 'scheduler_status',
  description: 'Get the status of all workflow schedules — compares DB state with in-memory cron jobs. Shows which schedules are registered, their cron expressions, last run, and next fire time. Use this to diagnose why a scheduled workflow has stopped running.',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'System Diagnostics',
  handler: async () => {
    const { getActiveJobs } = await import('$lib/workflows/scheduler');
    const activeJobs = getActiveJobs();

    const schedules = await db
      .select({
        id: workflowSchedules.id,
        workflowId: workflowSchedules.workflowId,
        type: workflowSchedules.type,
        config: workflowSchedules.config,
        enabled: workflowSchedules.enabled,
        lastRunAt: workflowSchedules.lastRunAt,
        nextRunAt: workflowSchedules.nextRunAt,
      })
      .from(workflowSchedules);

    // Get workflow names
    const wfIds = [...new Set(schedules.map((s) => s.workflowId))];
    const wfMap = new Map<string, string>();
    for (const wfId of wfIds) {
      const [wf] = await db
        .select({ name: workflows.name })
        .from(workflows)
        .where(eq(workflows.id, wfId))
        .limit(1);
      if (wf) wfMap.set(wfId, wf.name);
    }

    const entries = schedules.map((s) => {
      const job = activeJobs.get(s.id);
      const nextFire = job?.nextRun() ?? null;
      const expression = (s.config as Record<string, unknown>)?.expression as string | undefined;

      return {
        scheduleId: s.id,
        workflowId: s.workflowId,
        workflowName: wfMap.get(s.workflowId) || 'Unknown',
        cronExpression: expression || null,
        enabled: s.enabled,
        registeredInMemory: !!job,
        lastRunAt: s.lastRunAt,
        lastRunAtFormatted: formatTimestamp(s.lastRunAt),
        nextFireTime: nextFire?.toISOString() ?? s.nextRunAt?.toISOString() ?? null,
        nextFireTimeFormatted: formatTimestamp(nextFire ?? s.nextRunAt),
      };
    });

    return { success: true, data: entries };
  },
});

register({
  name: 'scheduler_run_history',
  description: 'Get recent scheduled workflow runs — shows status, timing, errors, and duration. Use to check if a schedule has been firing and whether runs succeeded or failed.',
  parameters: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'Filter by workflow ID. Omit for all scheduled runs.' },
      limit: { type: 'number', description: 'Max runs to return (default 20)' },
    },
  },
  category: 'System Diagnostics',
  handler: async (args) => {
    const limit = (args.limit as number) || 20;
    const workflowId = args.workflowId as string | undefined;

    const rows = await db
      .select()
      .from(workflowRuns)
      .where(
        workflowId
          ? and(eq(workflowRuns.trigger, 'scheduled'), eq(workflowRuns.workflowId, workflowId))
          : eq(workflowRuns.trigger, 'scheduled'),
      )
      .orderBy(desc(workflowRuns.startedAt))
      .limit(limit);

    const runs = rows.map((r) => {
      const durationMs = r.startedAt && r.completedAt
        ? new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()
        : null;

      return {
        id: r.id,
        workflowId: r.workflowId,
        status: r.status,
        startedAt: r.startedAt,
        startedAtFormatted: formatTimestamp(r.startedAt),
        completedAt: r.completedAt,
        completedAtFormatted: formatTimestamp(r.completedAt),
        durationMs,
        error: r.error,
      };
    });

    return { success: true, data: runs };
  },
});

// ==========================================
// System Logs
// ==========================================

register({
  name: 'system_logs',
  description: 'Read recent systemd journal entries for the app service (strange-rambling-svelte). Use to diagnose restarts, crashes, errors, or scheduler issues. Only works on the VPS.',
  parameters: {
    type: 'object',
    properties: {
      lines: { type: 'number', description: 'Number of log lines (default 50, max 200)' },
      filter: { type: 'string', description: 'Filter logs by keyword (e.g. "scheduler", "error", "restart"). Case-insensitive.' },
    },
  },
  category: 'System Diagnostics',
  handler: async (args) => {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const lineCount = Math.min(Math.max((args.lines as number) || 50, 1), 200);
    const filter = args.filter as string | undefined;

    // Sanitise filter to prevent shell injection — only allow alphanumeric, spaces, hyphens, underscores
    const safeFilter = filter?.replace(/[^a-zA-Z0-9\s\-_]/g, '') || '';

    let command = `journalctl -u strange-rambling-svelte --no-pager -n ${lineCount}`;
    if (safeFilter) {
      command += ` --grep="${safeFilter}" --case-sensitive=no`;
    }

    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 10000, maxBuffer: 1024 * 1024 });
      const logLines = stdout.trim().split('\n').filter(Boolean);
      return {
        success: true,
        data: {
          lines: logLines,
          count: logLines.length,
          filter: safeFilter || null,
        },
      };
    } catch (err: any) {
      // journalctl may not be available (e.g. running locally, not on VPS)
      if (err.stderr?.includes('No entries') || err.stdout === '') {
        return { success: true, data: { lines: [], count: 0, filter: safeFilter || null } };
      }
      return { success: false, error: `Failed to read logs: ${err.message}` };
    }
  },
});
