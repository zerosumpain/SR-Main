/**
 * D1 — Run outcome notifications.
 *
 * Per-workflow opt-in WhatsApp pings when a workflow run reaches a terminal
 * state: a failure alert (run failed / completed with errors) and/or a
 * completion digest. Wired into the engine's terminal-status seam (see
 * `engine.ts`, alongside the dedupe flush/discard hooks) so it fires identically
 * whether the run executed in the web process or the JKAI_RUN_WORKER process —
 * both go through `engine.execute`.
 *
 * Contract: this function NEVER throws. Every failure path is caught and logged
 * so a notification hiccup can never fail a run. When a workflow has no
 * `notifications` config (null/absent — the default for every existing
 * workflow) it does nothing, silently.
 *
 * WhatsApp sends are delegated to the Hermes bridge in production via the
 * WhatsApp service (`whatsapp/service.ts`), so this works in worker mode where
 * no local Baileys client is paired. The service is lazy-imported so the engine
 * doesn't pull in the WhatsApp stack unless a run actually needs to notify.
 */

import { ownerPhone } from '$lib/config/owner';
import { db } from '$lib/db';
import { workflows, type WorkflowNotifications } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { markdownToWhatsApp } from './whatsapp/format';

const SITE_URL = 'https://strangeramblings.com';
const CANVAS_NAME_PREFIX = 'canvas:';

/** Max characters for the truncated error line in a failure alert. */
const MAX_ERROR_CHARS = 300;
/** Max characters for the digest value appended to a completion ping. */
const MAX_DIGEST_CHARS = 500;

export interface NotifyRunOutcomeArgs {
  workflowId: string;
  /** Optional friendly name (the engine passes `workflow.name`, typically
   *  `canvas:<slug>`); resolved from the DB row when absent. */
  workflowName?: string | null;
  runId: string;
  /** Terminal run status from the engine. */
  status: string;
  /** Failure message (present on failed / completed_with_errors). */
  error?: string | null;
  /** Merged terminal-node outputs, used to resolve `digestField`. */
  terminalOutputs?: Record<string, unknown> | null;
}

/** Resolve a dot-path (e.g. "summary" or "result.text") against an object. */
function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let current: unknown = obj;
  for (const part of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Coerce an arbitrary digest value to a short string. Objects/arrays are
 *  JSON-stringified; everything else is `String()`-cast. Truncated to `max`. */
function stringifyDigest(value: unknown, max: number): string {
  if (value === null || value === undefined) return '';
  let str: string;
  if (typeof value === 'string') str = value;
  else if (typeof value === 'number' || typeof value === 'boolean') str = String(value);
  else {
    try {
      str = JSON.stringify(value);
    } catch {
      str = String(value);
    }
  }
  str = str.trim();
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

/** Best-effort display name + canvas slug from the workflow's name/description. */
export function resolveNaming(
  rowName: string | null | undefined,
  rowDescription: string | null | undefined,
  passedName: string | null | undefined,
  workflowId: string,
): { display: string; slug: string } {
  const name = (passedName || rowName || '').trim();
  const isCanvas = name.startsWith(CANVAS_NAME_PREFIX);
  const slug = isCanvas ? name.slice(CANVAS_NAME_PREFIX.length) || workflowId : workflowId;
  // Prefer the human canvas title (stored in description) for canvas workflows;
  // otherwise the plain name, else the id.
  const display = isCanvas
    ? (rowDescription?.trim() || slug)
    : (name || workflowId);
  return { display, slug };
}

async function sendWhatsApp(text: string): Promise<void> {
  try {
    const { getWhatsAppService } = await import('$lib/workflows/whatsapp/service');
    const wa = getWhatsAppService();
    const result = await wa.sendMessage(ownerPhone() ?? '', text);
    if (!result.sent) {
      console.warn(`[run-notifications] WhatsApp send failed: ${result.error ?? 'unknown error'}`);
    }
  } catch (err) {
    console.error('[run-notifications] WhatsApp send threw:', err instanceof Error ? err.message : err);
  }
}

/**
 * Notify the owner about a terminal run outcome, honouring the workflow's opt-in
 * `notifications` config. Silent no-op when the workflow has no config. Never
 * throws.
 */
export async function notifyRunOutcome(args: NotifyRunOutcomeArgs): Promise<void> {
  try {
    const { workflowId, runId, status } = args;

    // Only terminal outcomes matter; a paused/awaiting-human run is not "done".
    const isFailure = status === 'failed' || status === 'completed_with_errors';
    const isCompletion = status === 'completed';
    if (!isFailure && !isCompletion) return;

    // Child invocations (sub-workflow node / loop subworkflow mode) carry a
    // `sub-` runId prefix. Their outcome surfaces through the PARENT run's
    // node result — notifying per child would spam N messages for one fan-out.
    if (runId.startsWith('sub-')) return;

    const [row] = await db
      .select({
        name: workflows.name,
        description: workflows.description,
        notifications: workflows.notifications,
      })
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .limit(1);

    const cfg: WorkflowNotifications | null | undefined = row?.notifications;
    // Default silent: no row, no config, or an empty object → nothing to do.
    if (!cfg || (cfg.onFailure !== true && cfg.onCompletion !== true)) return;

    // Only WhatsApp is wired today. `undefined` channel defaults to whatsapp.
    if (cfg.channel && cfg.channel !== 'whatsapp') return;

    const { display, slug } = resolveNaming(row?.name, row?.description, args.workflowName, workflowId);
    const url = `${SITE_URL}/jkai/canvas/${slug}`;

    if (isFailure) {
      if (cfg.onFailure !== true) return;
      const rawError = (args.error ?? '').trim() ||
        (status === 'completed_with_errors' ? 'completed with errors' : 'run failed');
      const errorLine = rawError.length > MAX_ERROR_CHARS
        ? `${rawError.slice(0, MAX_ERROR_CHARS - 1)}…`
        : rawError;
      await sendWhatsApp(`⚠ Workflow ${display} failed: ${errorLine} — ${url}`);
      return;
    }

    // isCompletion
    if (cfg.onCompletion !== true) return;
    let message = `✓ ${display} completed`;
    if (cfg.digestField) {
      const raw = resolvePath(args.terminalOutputs ?? {}, cfg.digestField);
      const digest = stringifyDigest(raw, MAX_DIGEST_CHARS);
      if (digest) {
        // Run the digest through the markdown→WhatsApp translator so a model's
        // markdown (headings/bold/links) renders cleanly on the phone.
        message += `\n\n${markdownToWhatsApp(digest)}`;
      }
    }
    message += `\n\n${url}`;
    await sendWhatsApp(message);
  } catch (err) {
    // Absolute belt-and-braces: nothing in here may propagate to the engine.
    console.error('[run-notifications] notifyRunOutcome threw:', err instanceof Error ? err.message : err);
  }
}
