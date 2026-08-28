// src/lib/workflowdoctor/report.ts
//
// REPORT phase. Builds the human-readable run report, persists the final
// `doctor_runs` record, and sends a short (<=600 char) WhatsApp summary to the
// owner via the existing `whatsapp_send` site tool.
//
// The summary is the only doctor output that leaves the owner-gated surfaces,
// so it is composed from COUNTS, CANVAS SLUGS and FIX-KIND NAMES and nothing
// else. The release-log leak is the precedent: machine-written text about a bug
// quotes the data that caused the bug, and the data that causes these bugs is
// credentials in node config.

import { upsertRecord } from '$lib/datastore';
import { hasSensitive } from '$lib/security/sensitive';
import { getOwnerPhone } from '$lib/workflows/whatsapp/approval-notify';
import {
  COLLECTIONS,
  FIX_KIND_LABELS,
  SYSTEM_ACTOR,
  WORK_CAPS,
  asData,
  errMsg,
  type DoctorAction,
  type DoctorRunData,
  type FixKind,
} from './types';

const DOCTOR_LINK = 'https://strangeramblings.com/jkai/doctor';

/** Named canvases per line, and fix-kind groups on the PROPOSED line. */
const MAX_NAMED = 3;
const MAX_GROUPS = 3;

// ---------------------------------------------------------------------------
// Action → (canvas slug, fix kind)
// ---------------------------------------------------------------------------

/**
 * `DoctorAction` carries no `fixKind` field, so the kind is recovered from the
 * action's own text. Both spellings are accepted because an emitting phase may
 * write the enum token (`enum-violation`) or the label (`invalid dropdown
 * value`); longest needle first so a specific kind cannot be shadowed by a
 * shorter one that happens to be a substring.
 */
const KIND_NEEDLES: Array<{ kind: FixKind; needle: string }> = (
  Object.keys(FIX_KIND_LABELS) as FixKind[]
)
  .flatMap((kind) => [
    { kind, needle: kind.toLowerCase() },
    { kind, needle: FIX_KIND_LABELS[kind].toLowerCase() },
  ])
  .sort((a, b) => b.needle.length - a.needle.length);

function fixKindOf(action: DoctorAction): FixKind | null {
  // Forward-compatible: if the shape ever grows the field, prefer it over prose.
  const declared = (action as Partial<{ fixKind: FixKind }>).fixKind;
  if (declared && declared in FIX_KIND_LABELS) return declared;

  const hay = `${action.detail} ${action.story?.fix ?? ''} ${action.story?.cause ?? ''}`.toLowerCase();
  for (const { kind, needle } of KIND_NEEDLES) if (hay.includes(needle)) return kind;
  return null;
}

/**
 * The canvas slug, and only the canvas slug.
 *
 * The charset is pinned rather than trusted: everything between `canvas:` and
 * the first non-slug character is what a workflow name is allowed to be, so an
 * error string spliced into the same field cannot ride along. `hasSensitive`
 * then catches the one thing the charset still permits — a long digit run.
 */
const SLUG_RE = /canvas:([a-z0-9][a-z0-9-]{0,48})/i;

function slugOf(action: DoctorAction): string | null {
  const m = SLUG_RE.exec(action.story?.subject ?? '') ?? SLUG_RE.exec(action.detail);
  if (!m) return null;
  const slug = m[1].toLowerCase();
  return hasSensitive(slug) ? null : slug;
}

/** `morning-briefing (invalid dropdown value)`, degrading to whichever half we have. */
function describeFix(action: DoctorAction): string | null {
  const slug = slugOf(action);
  const kind = fixKindOf(action);
  if (slug && kind) return `${slug} (${FIX_KIND_LABELS[kind]})`;
  return slug ?? (kind ? FIX_KIND_LABELS[kind] : null);
}

/** `a, b, c +2 more` — dedup first, so two fixes on one canvas do not read as two canvases. */
function nameList(names: string[], max = MAX_NAMED): string {
  const unique = Array.from(new Set(names.filter(Boolean)));
  if (!unique.length) return '';
  const shown = unique.slice(0, max).join(', ');
  const rest = unique.length - max;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

// ---------------------------------------------------------------------------
// Report text
// ---------------------------------------------------------------------------

/** Full markdown-ish report stored on the run record and shown on the page. */
export function buildReportText(data: DoctorRunData): string {
  const lines: string[] = [];
  lines.push(`# Workflow doctor run (${data.trigger})`);
  lines.push(`Status: ${data.status}`);
  // The headline leads: how many canvases are broken is the number this engine
  // is graded on, and every other count below is a means to moving it.
  lines.push(
    `Canvases failing (last ${WORK_CAPS.lookbackDays}d): ${data.workflowsFailing} across ${data.signaturesSeen} signature(s)`,
  );
  lines.push(`Started: ${data.startedAt}${data.finishedAt ? ` · Finished: ${data.finishedAt}` : ''}`);
  lines.push(
    `Budget: ${data.llmCalls} LLM call(s), ${data.tokensIn}+${data.tokensOut} tokens, ~$${data.costUsd.toFixed(3)}`,
  );
  // Both switches, snapshotted at run time. Without this a shadow night — one
  // that could only ever propose — reads as a night that chose not to fix.
  lines.push(
    `Switches: auto-apply ${data.autoApplyEnabled ? 'ON' : 'OFF (shadow)'} · circuit breaker ${data.breakerEnabled ? 'ON' : 'OFF'}`,
  );
  lines.push(
    `Outcome: ${data.fixesApplied} applied, ${data.fixesReverted} reverted, ${data.fixesRefusedSensitive} refused (sensitive config), ${data.schedulesQuarantined} schedule(s) quarantined, ${data.proposalsOpened} proposed, ${data.findingsResolved} resolved`,
  );
  lines.push(
    `WhatsApp: ${data.whatsappDelivered ? 'summary delivered' : 'summary did NOT reach WhatsApp'}`,
  );
  lines.push('');
  lines.push('## Phases');
  for (const [name, p] of Object.entries(data.phases)) {
    lines.push(`- ${name}: ${p.status}${p.detail ? ` — ${p.detail}` : ''}${p.ms ? ` (${p.ms}ms)` : ''}`);
  }
  lines.push('');
  lines.push('## Actions');
  if (data.actions.length === 0) {
    lines.push('- (none)');
  } else {
    for (const a of data.actions) lines.push(`- [${a.kind}] ${a.detail}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// WhatsApp summary
// ---------------------------------------------------------------------------

/**
 * Short WhatsApp summary, hard-capped at 600 chars. Pure — no DB, no clock.
 *
 * The count of CANVASES FAILING leads because that is the number the feature is
 * graded on; a night that fixed two things while five more broke is not a good
 * night. REFUSED is always shown when non-zero: it is the only line that demands
 * a human, and the remedy (delete the node, never PATCH it) is not something the
 * doctor can ever do for itself.
 *
 * Composed exclusively from recorded counts, canvas slugs and fix-kind labels.
 * Never an error string, a config value, a nodeId or a URL out of a failing
 * workflow — those all pass through the summary's inputs and none of them
 * reaches its output.
 */
export function buildWhatsappSummary(data: DoctorRunData): string {
  const parts: string[] = [];

  if (data.workflowsFailing > 0) {
    parts.push(
      `sr. workflow doctor (${data.status}): ${data.workflowsFailing} ${plural(data.workflowsFailing, 'canvas', 'canvases')} failing.`,
    );
  } else {
    parts.push(
      `sr. workflow doctor (${data.status}): No failures in ${WORK_CAPS.lookbackDays} days.`,
    );
  }

  const fixed = nameList(
    data.actions.filter((a) => a.kind === 'fix_applied').map(describeFix).filter(Boolean) as string[],
  );
  if (data.fixesApplied > 0) parts.push(`FIXED ${data.fixesApplied}${fixed ? `: ${fixed}` : ''}.`);

  // Quarantines name the canvas only — the kind is always runaway-schedule, so
  // repeating it three times buys nothing at 600 characters.
  const quarantined = nameList(
    data.actions.filter((a) => a.kind === 'schedule_quarantined').map(slugOf).filter(Boolean) as string[],
  );
  if (data.schedulesQuarantined > 0) {
    parts.push(
      `QUARANTINED ${data.schedulesQuarantined} ${plural(data.schedulesQuarantined, 'schedule')}${quarantined ? `: ${quarantined}` : ''}.`,
    );
  }

  if (data.proposalsOpened > 0) {
    const groups = new Map<string, number>();
    for (const a of data.actions.filter((x) => x.kind === 'proposal')) {
      const kind = fixKindOf(a);
      const label = kind ? FIX_KIND_LABELS[kind] : 'unclassified';
      groups.set(label, (groups.get(label) ?? 0) + 1);
    }
    const ranked = [...groups.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, n]) => `${n} ${label}`);
    const grouped = nameList(ranked, MAX_GROUPS);
    parts.push(`PROPOSED ${data.proposalsOpened}${grouped ? `: ${grouped}` : ''}.`);
  }

  if (data.fixesRefusedSensitive > 0) {
    parts.push(
      `${data.fixesRefusedSensitive} REFUSED: ${FIX_KIND_LABELS['secret-in-node-config']} — needs you.`,
    );
  }

  const acted =
    data.fixesApplied + data.schedulesQuarantined + data.proposalsOpened + data.fixesRefusedSensitive;
  if (data.workflowsFailing > 0 && acted === 0) parts.push('Nothing to fix.');

  parts.push(`~$${data.costUsd.toFixed(2)}, ${data.llmCalls} calls.`);

  // Trim the BODY, not the tail. The cap below would otherwise eat the link,
  // which is the only part of the message you can act on.
  let body = parts.join('\n');
  const bodyMax = 600 - DOCTOR_LINK.length - 4;
  if (body.length > bodyMax) body = `${body.slice(0, bodyMax - 3)}...`;

  const msg = `${body}\n${DOCTOR_LINK}`;
  return msg.length > 600 ? msg.slice(0, 597) + '...' : msg;
}

// ---------------------------------------------------------------------------
// Finalise
// ---------------------------------------------------------------------------

/**
 * Finalise a run: stamp the report text, persist the record, and (best-effort)
 * notify over WhatsApp. Persistence errors propagate so the caller can mark the
 * report phase failed; the WhatsApp send never throws.
 *
 * `executeTool` swallows a send failure and returns `{ success: false, error }`,
 * which is why the three existing nightly jobs go silent when the bridge is
 * down and nobody finds out. We read `success`, record it, and persist again so
 * the page can say the summary never arrived.
 */
export async function finalizeAndNotify(runId: string, data: DoctorRunData): Promise<void> {
  data.report = buildReportText(data);
  await upsertRecord(COLLECTIONS.doctorRuns, { key: runId, data: asData(data) }, SYSTEM_ACTOR);

  try {
    // Lazy so unit tests — and the cron path on a night with nothing to say —
    // never pull the whole site-tool registry into the module graph.
    const { executeTool } = await import('$lib/workflows/site-tools/registry');
    const res = await executeTool('whatsapp_send', {
      to: getOwnerPhone(),
      message: buildWhatsappSummary(data),
    });
    data.whatsappDelivered = res?.success === true;
    if (!data.whatsappDelivered) {
      console.error('[workflowdoctor] whatsapp send failed:', res?.error ?? 'no error given');
    }
  } catch (err) {
    data.whatsappDelivered = false;
    console.error('[workflowdoctor] whatsapp summary failed:', errMsg(err));
  }

  // Re-stamp: the first report text was written before the send, so it says the
  // summary did not arrive on every night, including the ones where it did.
  data.report = buildReportText(data);
  try {
    await upsertRecord(COLLECTIONS.doctorRuns, { key: runId, data: asData(data) }, SYSTEM_ACTOR);
  } catch (err) {
    // The run is already durable and the message is already sent; failing the
    // report phase over a delivery flag would misreport a night that worked.
    console.error('[workflowdoctor] delivery-flag persist failed:', errMsg(err));
  }
}
