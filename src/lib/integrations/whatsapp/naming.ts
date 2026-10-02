/**
 * Display name and canvas slug for a workflow named in an approval message.
 *
 * Kept from the retired run-outcome notifier (`run-notifications.ts`, removed
 * 2026-10-02 with Main's workflow engine): SR-Workflows now sends run outcomes,
 * and only the WhatsApp approval messages still name a workflow here.
 */
const CANVAS_NAME_PREFIX = 'canvas:';

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
