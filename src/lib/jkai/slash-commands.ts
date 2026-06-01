/**
 * Slash-command UI affordances — extensible registry of patterns in
 * assistant messages that warrant in-line buttons in the chat UI.
 *
 * Each entry has:
 *   - id: stable identifier (used to track which prompts have been actioned)
 *   - detect(content): predicate over the assistant message text
 *   - buttons: list of buttons to render. Each button's `command` is sent
 *     to Hermes as a *silent* user message (the slash command is not
 *     persisted as a visible user bubble).
 *
 * Adding a new affordance = pushing one entry here. The chat UI does NOT
 * need to be touched.
 */

export interface SlashButton {
  /** Label shown on the button. */
  label: string;
  /** Slash command sent to Hermes. The Hermes side already interprets `/approve`,
   *  `/approve always`, `/deny`, `/background`, etc. */
  command: string;
  /** Visual style hint. Default 'primary'. */
  style?: 'primary' | 'danger' | 'subtle';
}

export interface SlashAffordance {
  id: string;
  /** True when the assistant message text matches this affordance. */
  detect(content: string): boolean;
  buttons: SlashButton[];
}

const APPROVAL_PROMPT_PREFIX = '⚠️ **Dangerous command requires approval:**';

/** Match Hermes's approval prompt — the only platform-emitted text that
 * currently requires a user decision. Hermes also signals approval-required
 * via plain text "you can /approve / /approve always / /deny" lines in some
 * other contexts; we keep detection narrow for now to avoid false positives
 * on assistant prose that happens to mention the same words. */
function isApprovalPrompt(content: string): boolean {
  return content.includes(APPROVAL_PROMPT_PREFIX);
}

// Safe-by-default: this is a "dangerous command" gate, so the SAFE action
// (Deny) is the dominant, recommended button and comes first. Approving
// proceeds with the dangerous command, so it's marked as a caution (outlined,
// not filled) and requires a deliberate click; "Approve always" is quieter
// still.
//
// Exported so the structured approval card (`pendingApproval` in
// ChatArea.svelte) can hand this object straight to SlashCommandButtonBar —
// the same buttons + auto-select behaviour the prose-fallback path uses, with
// no second source of truth for the command strings.
export const approvalAffordance: SlashAffordance = {
  id: 'hermes-approval',
  detect: isApprovalPrompt,
  buttons: [
    { label: 'Deny', command: '/deny', style: 'primary' },
    { label: 'Approve', command: '/approve', style: 'danger' },
    { label: 'Approve always', command: '/approve always', style: 'subtle' },
  ],
};

export const slashAffordances: SlashAffordance[] = [approvalAffordance];

/** Returns the first affordance whose `detect` matches, or null. */
export function findAffordance(content: string): SlashAffordance | null {
  for (const a of slashAffordances) {
    if (a.detect(content)) return a;
  }
  return null;
}
