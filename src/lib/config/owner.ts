// The owner's contact details, read from the environment — never literals.
//
// John's WhatsApp number was hard-coded in five separate source files
// (`site-tools/registry.ts`, `briefing/types.ts`, `selfimprove/types.ts`,
// `jkai/intel/notify.ts`, `connectors/monitor.ts`) and, in the first of those,
// appended verbatim to the always-on system prompt — so it went into the repo,
// into every commit, and out to a model on every turn. The standing rule is
// that it never appears in code, commits or public pages.
//
// One accessor, one env var. `WORKFLOW_NOTIFY_PHONE` already existed for
// exactly this in `workflows/whatsapp/approval-notify.ts`; this generalises it
// rather than inventing a second name.

import { env } from '$env/dynamic/private';

/** Warn once per process, not once per call — these sit on hot paths. */
let warned = false;

/**
 * The owner's WhatsApp number in E.164, or `null` when unset.
 *
 * Returns null rather than a fallback literal on purpose: a default here is how
 * the number gets back into the source tree. Callers must handle null — and
 * every one of them can, because "we have no number to notify" is a real state
 * that should be visible rather than papered over.
 *
 * The absence is logged loudly because this is precisely the class of
 * configuration that fails silently: a missing env var on one host means alerts
 * simply stop arriving, with nothing in the UI to say so.
 */
export function ownerPhone(): string | null {
  const raw = env.WORKFLOW_NOTIFY_PHONE?.trim();
  if (raw) return raw;
  if (!warned) {
    warned = true;
    console.error(
      '[config] WORKFLOW_NOTIFY_PHONE is not set — owner WhatsApp notifications ' +
        '(briefing, alerts, connector monitor, intel) have nowhere to go.',
    );
  }
  return null;
}

/** Test-only: clear the once-per-process warning latch. */
export function resetOwnerPhoneWarning(): void {
  warned = false;
}
