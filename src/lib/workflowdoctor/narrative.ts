// src/lib/workflowdoctor/narrative.ts
//
// Plain-English cards over the doctor's findings — one card per finding,
// answering three questions in order: what went wrong, why, and what was done
// about it.
//
// Design constraints, inherited from $lib/selfimprove/narrative:
//
//  - EVIDENCE-BOUND, NO MODEL. Every sentence here is assembled from recorded
//    fields. Nothing is sent to an LLM to be "written up". The morning briefing
//    taught this the hard way: a fluent summary of machine data reads exactly as
//    authoritative when it is wrong as when it is right, and the failure is
//    silent. Where a fact is missing this module says so rather than filling it.
//
//  - PROVENANCE IS RENDERED, NOT FLATTENED. `causeSource` passes straight
//    through so the page can show an LLM guess as visibly weaker than a linter
//    fact. The doctor is structurally blind to what a node actually received at
//    failure time (`node_executions.inputData` is NULL on every failed row), so
//    a confident tone would outrun the evidence.
//
//  - MEASURED vs EXPECTED vs UNPROVEN. `measured` is reserved for a post-fix
//    verify count that ACTUALLY FELL. A fix applied last night with nothing run
//    since reads "too early to tell", exactly as the improvement ledger does,
//    and a fix that was rolled back is `unproven` — measuring the absence of an
//    improvement is not the same as measuring one.
//
//  - A REFUSAL NAMES THE FIELD, NEVER THE VALUE. `sensitiveFields` is stripped
//    to bare names again here even though findings.ts already did it on the way
//    in: this module is the last thing between the store and a rendered page.
//
// Pure by design — no database, no Svelte, no fetch — so the whole derivation is
// unit-testable from fixtures. The caller supplies every input.

import {
  AUTO_APPLY_KINDS,
  BREAKER_KIND,
  FIX_KIND_LABELS,
  type DoctorFindingData,
  type DoctorRunData,
  type DoctorStory,
  type FindingStatus,
  type FixKind,
} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A run as loaded by the page — key, timestamp, and the stored record. */
export interface NarrativeRun {
  runId: string;
  createdAt: string;
  data: DoctorRunData;
}

/** A stored finding plus its datastore key — what `listFindings()` returns. */
export interface NarrativeFinding {
  key: string;
  data: DoctorFindingData;
}

export interface DoctorNarrativeInput {
  runs: NarrativeRun[];
  findings: NarrativeFinding[];
}

/** One dated step in a finding's arc: first seen → acted on → closed. */
export interface StoryStep {
  at: string;
  label: string;
}

/**
 * The page's card. Extends the stored `DoctorStory` triple with the handles and
 * dates the surface needs — status rule, filter, arc footer, revert action —
 * so the component renders finished sentences instead of re-deriving them.
 */
export interface DoctorStoryCard extends DoctorStory {
  /** Datastore key of the finding; the handle the admin actions act on. */
  id: string;
  status: FindingStatus;
  statusLabel: string;
  fixKind: FixKind;
  fixKindLabel: string;
  workflowId: string;
  workflowName: string;
  canvasSlug: string | null;
  nodeId: string | null;
  /** A caveat the reader needs in order to trust the card. */
  note?: string;
  /** Field NAMES only, never values. Populated on `refused_sensitive`. */
  sensitiveFields?: string[];
  arc: StoryStep[];
  firstSeen: string;
  lastSeen: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Thousands separators without ICU — `5053` → `5,053`. */
function fmtCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function plural(n: number, word: string, suffix = 's'): string {
  return `${fmtCount(n)} ${word}${n === 1 ? '' : suffix}`;
}

/** The occurrence count as a noun phrase: `5,053 failures`. */
export function formatOccurrences(n: number): string {
  return plural(Math.max(0, Math.round(Number(n) || 0)), 'failure');
}

function dayLabel(iso: string | null | undefined): string {
  const d = new Date(iso ?? '');
  if (Number.isNaN(d.getTime())) return 'an unknown date';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function unpunctuated(text: string): string {
  return (text ?? '').trim().replace(/[.\s]+$/, '');
}

function count(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * A bare field name, with anything that looks like a value cut off.
 *
 * findings.ts already strips values on the way in. This repeats the strip
 * because a card is a rendering surface and the whole point of a refusal is
 * that the value must not travel — one caller passing `apiKey=sk-…` by mistake
 * should cost nothing.
 */
function fieldNameOnly(raw: string): string {
  return String(raw ?? '')
    .split(/[=:]/)[0]
    .trim()
    .slice(0, 120);
}

function fieldNames(names: string[] | undefined): string[] | undefined {
  if (!names?.length) return undefined;
  const out = Array.from(new Set(names.map(fieldNameOnly).filter(Boolean)));
  return out.length ? out : undefined;
}

/** `` `a` `` · `` `a` and `b` `` · `` `a`, `b` and `c` ``. */
function codeList(items: string[]): string {
  const quoted = items.map((i) => `\`${i}\``);
  if (quoted.length <= 1) return quoted[0] ?? '';
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<FindingStatus, string> = {
  proposed: 'proposed',
  auto_fixed: 'fixed automatically',
  reverted: 'rolled back',
  refused_sensitive: 'needs you',
  accepted: 'accepted',
  dismissed: 'dismissed',
  resolved: 'resolved',
};

/**
 * Card order. A refusal leads because it is the only status no amount of
 * further nights can clear — only a human can. Then what the doctor changed
 * (fixed, then rolled back), then what it is asking for, then history.
 */
const STATUS_WEIGHT: Record<FindingStatus, number> = {
  refused_sensitive: 0,
  auto_fixed: 1,
  reverted: 2,
  proposed: 3,
  accepted: 4,
  resolved: 5,
  dismissed: 6,
};

function isBreaker(f: DoctorFindingData): boolean {
  return f.fixKind === BREAKER_KIND || Boolean(f.beforeImage?.scheduleId);
}

/** Kinds the doctor is allowed to apply on its own, breaker included. */
function isMechanical(kind: FixKind): boolean {
  return kind === BREAKER_KIND || AUTO_APPLY_KINDS.includes(kind);
}

/**
 * What the doctor DID, not what the fix kind permits. A whitelisted kind left
 * alone because auto-apply was off is a proposal, and the card must say so.
 */
function fixModeFor(status: FindingStatus): DoctorStory['fixMode'] {
  if (status === 'refused_sensitive') return 'refused';
  if (status === 'auto_fixed' || status === 'reverted') return 'auto-apply';
  return 'propose-only';
}

/** Did the post-fix verify count fall, hold, or was it never taken? */
function verifyVerdict(f: DoctorFindingData): 'fell' | 'held' | 'none' {
  const { verifyBefore: before, verifyAfter: after } = f;
  if (typeof before !== 'number' || typeof after !== 'number') return 'none';
  return after < before ? 'fell' : 'held';
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

interface Ctx {
  /** When the doctor last acted, from the run record where one is loaded. */
  actedAt: string;
  /** Completed runs since this finding was last touched. */
  runsSince: number;
  /** The night this was found ran with the relevant switch off. */
  shadowNight: boolean;
}

interface Outcome {
  outcome: string;
  outcomeKind: DoctorStory['outcomeKind'];
}

const REFUSAL_NOTE =
  'Do not edit the node to strip the value — a config PATCH republishes the OLD value through the ' +
  'canvas audit log, which is how it spreads. Delete the node and recreate it.';

/**
 * The honest reading of an applied fix with no post-fix measurement. Both
 * branches are facts about runs, not claims about the node.
 */
function unprovenTail(ctx: Ctx): string {
  if (ctx.runsSince === 0) {
    return 'No doctor run has completed since, so it is too early to tell whether the failure has stopped.';
  }
  return (
    `${plural(ctx.runsSince, 'later run')} ${ctx.runsSince === 1 ? 'has' : 'have'} not recorded it again — ` +
    'weak evidence, but the only kind there is without a post-fix check.'
  );
}

function outcomeFor(f: DoctorFindingData, ctx: Ctx): Outcome {
  const day = dayLabel(ctx.actedAt);
  const verdict = verifyVerdict(f);
  const errs = `from ${f.verifyBefore} to ${f.verifyAfter}`;
  const occ = count(f.occurrences);

  switch (f.status) {
    case 'refused_sensitive': {
      const names = fieldNames(f.sensitiveFields);
      const subject = names
        ? names.length === 1
          ? `The value stored in ${codeList(names)}`
          : `The values stored in ${codeList(names)}`
        : 'A value stored on this node';
      return {
        outcome:
          `Nothing on this node was touched. ${subject} looks like a credential, and even a patch that ` +
          'removed it would republish the old value through the canvas audit log — so this one is yours: ' +
          'delete the node and recreate it.',
        outcomeKind: 'expected',
      };
    }

    case 'auto_fixed': {
      const head = isBreaker(f)
        ? `The schedule was switched off automatically on ${day}, so it stops retrying. The canvas itself is ` +
          'unchanged and will fail again if the schedule is switched back on.'
        : `Applied automatically on ${day}.`;
      if (verdict === 'fell') {
        return {
          outcome: `${head} The canvas's checker errors fell ${errs} afterwards.`,
          outcomeKind: 'measured',
        };
      }
      return { outcome: `${head} ${unprovenTail(ctx)}`, outcomeKind: 'unproven' };
    }

    case 'reverted':
      return {
        outcome:
          `Applied on ${day} and undone in the same run` +
          (verdict === 'held'
            ? `: the canvas's checker errors went ${errs} instead of down.`
            : ': the graph did not come out cleaner.') +
          ' The node is back as it was.',
        outcomeKind: 'unproven',
      };

    case 'resolved': {
      const stopped =
        `This failure has not been seen since ${dayLabel(f.lastSeen)}, so the finding was closed on ` +
        `${dayLabel(f.updatedAt)}.`;
      if (verdict === 'fell') {
        return {
          outcome: `${stopped} The checker errors on the canvas fell ${errs} when the fix went in.`,
          outcomeKind: 'measured',
        };
      }
      return {
        outcome:
          `${stopped} ` +
          (f.beforeImage
            ? 'The doctor did change this node, but a signature that stops arriving is not proof the change is why.'
            : 'The doctor changed nothing here, so whatever fixed it happened elsewhere.'),
        outcomeKind: 'unproven',
      };
    }

    case 'accepted':
      return {
        outcome:
          `You accepted this on ${dayLabel(f.updatedAt)}. It will not be re-proposed, and it closes by itself ` +
          'once the failure stops arriving.',
        outcomeKind: 'expected',
      };

    case 'dismissed':
      return {
        outcome:
          `You dismissed this on ${dayLabel(f.updatedAt)}. It stays counted but will not be proposed again.`,
        outcomeKind: 'expected',
      };

    case 'proposed':
    default:
      return {
        outcome:
          'Nothing has been changed — this is a proposal.' +
          (occ > 0 ? ` ${formatOccurrences(occ)} recorded since ${dayLabel(f.firstSeen)}.` : '') +
          ' It keeps failing until someone applies the fix above.',
        outcomeKind: 'expected',
      };
  }
}

function noteFor(f: DoctorFindingData, ctx: Ctx): string | undefined {
  if (f.status === 'refused_sensitive') return REFUSAL_NOTE;
  if (f.status === 'reverted') {
    return 'A fix is kept only when it makes the graph strictly cleaner. This one did not, so it was rolled back in the same run.';
  }
  if (f.status === 'proposed' && ctx.shadowNight) {
    return (
      `This is a fix the doctor can apply on its own, but ${isBreaker(f) ? 'the circuit breaker' : 'auto-apply'} ` +
      `was off on ${dayLabel(ctx.actedAt)}, so it was recorded rather than applied.`
    );
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function subjectFor(f: DoctorFindingData): string {
  const workflow =
    (f.workflowName ?? '').trim() ||
    (f.canvasSlug ? `canvas:${f.canvasSlug}` : '') ||
    'an unnamed workflow';
  const node = (f.nodeLabel ?? '').trim() || (f.nodeType ?? '').trim();
  return node ? `${workflow} / ${node}` : workflow;
}

/** first seen → what was done → closed. Only dates that were actually recorded. */
function arcFor(f: DoctorFindingData, ctx: Ctx): StoryStep[] {
  const steps: StoryStep[] = [];
  if (f.firstSeen) steps.push({ at: f.firstSeen, label: 'first seen' });

  const actedLabel: Partial<Record<FindingStatus, string>> = {
    auto_fixed: isBreaker(f) ? 'schedule switched off' : 'fixed automatically',
    reverted: 'rolled back',
    refused_sensitive: 'refused — needs you',
    proposed: 'proposed',
    accepted: 'accepted',
    dismissed: 'dismissed',
    resolved: 'stopped failing',
  };
  const label = actedLabel[f.status];
  const at = f.status === 'resolved' ? f.lastSeen || f.updatedAt : ctx.actedAt || f.updatedAt;
  if (label && at) steps.push({ at, label });

  if (f.status === 'resolved' && f.updatedAt) steps.push({ at: f.updatedAt, label: 'closed' });

  // Same date + same label twice is noise, not history.
  const seen = new Set<string>();
  return steps.filter((s) => {
    const k = `${s.at}|${s.label}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Runs that finished AFTER a finding was last touched.
 *
 * Only complete/partial runs count: an aborted or failed run proves nothing
 * about whether a failure recurred, and counting it would turn a skipped night
 * into evidence.
 */
function runsCompletedAfter(runs: NarrativeRun[], iso: string | undefined): number {
  if (!iso) return 0;
  return runs.filter(
    (r) =>
      r.createdAt > iso && (r.data?.status === 'complete' || r.data?.status === 'partial'),
  ).length;
}

function assemble(row: NarrativeFinding, runs: NarrativeRun[], runById: Map<string, NarrativeRun>): DoctorStoryCard | null {
  const f = row?.data;
  if (!f) return null;

  const status: FindingStatus = f.status ?? 'proposed';
  const fixKind: FixKind = f.fixKind ?? 'unclassified';
  const actedRun = f.lastRunId ? runById.get(f.lastRunId) ?? null : null;
  const actedAt = actedRun?.createdAt || f.updatedAt || f.lastSeen || f.firstSeen || '';

  // A shadow night is only knowable from the run record that produced the
  // finding. With no run loaded the caveat is dropped rather than guessed.
  const shadowNight =
    !!actedRun &&
    isMechanical(fixKind) &&
    (isBreaker(f) ? actedRun.data?.breakerEnabled === false : actedRun.data?.autoApplyEnabled === false);

  const ctx: Ctx = {
    actedAt,
    runsSince: runsCompletedAfter(runs, f.updatedAt),
    shadowNight,
  };

  const occ = count(f.occurrences);
  const signature = (f.signature ?? '').trim();
  const evidence = [
    signature,
    occ > 0 ? `${formatOccurrences(occ)} since ${dayLabel(f.firstSeen)}` : '',
  ].filter(Boolean);

  const { outcome, outcomeKind } = outcomeFor({ ...f, status, fixKind }, ctx);

  return {
    id: row.key,
    subject: subjectFor(f),
    symptom: (f.symptom ?? '').trim() || 'This node keeps failing.',
    symptomEvidence: evidence.length ? evidence.join(' · ') : undefined,
    occurrences: occ > 0 ? occ : undefined,
    cause: (f.cause ?? '').trim() || 'The doctor could not say why from what was recorded.',
    // Straight through: a linter fact and a model's guess must never render the
    // same, and re-deriving provenance here would be a second guess.
    causeSource: f.causeSource ?? 'signature',
    fix: (f.fix ?? '').trim() || 'No mechanical fix — this one needs a look.',
    fixMode: fixModeFor(status),
    outcome,
    outcomeKind,

    status,
    statusLabel: STATUS_LABELS[status] ?? status,
    fixKind,
    fixKindLabel: FIX_KIND_LABELS[fixKind] ?? String(fixKind),
    workflowId: f.workflowId,
    workflowName: (f.workflowName ?? '').trim(),
    canvasSlug: f.canvasSlug ?? null,
    nodeId: f.nodeId ?? null,
    note: noteFor(f, ctx),
    sensitiveFields: status === 'refused_sensitive' ? fieldNames(f.sensitiveFields) : undefined,
    arc: arcFor(f, ctx),
    firstSeen: f.firstSeen,
    lastSeen: f.lastSeen,
    updatedAt: f.updatedAt,
  };
}

/**
 * Build the cards.
 *
 * Ordered by what the reader can do about it: a refusal only a human can clear,
 * then what the doctor changed last night, then what it is asking for, loudest
 * first. Volume is the argument — 5,053 failures outranks 2, whatever the kind.
 */
export function buildDoctorStories(input: DoctorNarrativeInput): DoctorStoryCard[] {
  const runs = [...(input?.runs ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const runById = new Map(runs.map((r) => [r.runId, r]));

  const cards: DoctorStoryCard[] = [];
  for (const row of input?.findings ?? []) {
    const card = assemble(row, runs, runById);
    if (card) cards.push(card);
  }

  return cards.sort(
    (a, b) =>
      STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status] ||
      (b.occurrences ?? 0) - (a.occurrences ?? 0) ||
      (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '') ||
      a.id.localeCompare(b.id),
  );
}

/**
 * The one-line header over the cards. Leads with canvases affected — the number
 * the feature is graded on — and never counts a closed finding as a live one.
 */
export function summariseDoctorStories(stories: DoctorStoryCard[]): string {
  const list = stories ?? [];
  if (list.length === 0) return 'No failing workflows recorded — nothing for the doctor to report.';

  const by = (status: FindingStatus) => list.filter((s) => s.status === status).length;
  const open = list.filter((s) => s.status !== 'resolved' && s.status !== 'dismissed');
  const canvases = new Set(open.map((s) => s.workflowId)).size;

  const parts: string[] = [];
  const refused = by('refused_sensitive');
  const fixed = by('auto_fixed');
  const reverted = by('reverted');
  const proposed = by('proposed');
  const resolved = by('resolved');

  if (fixed) parts.push(`${fmtCount(fixed)} fixed automatically`);
  if (reverted) parts.push(`${fmtCount(reverted)} rolled back`);
  if (proposed) parts.push(`${fmtCount(proposed)} proposed`);
  if (refused) parts.push(`${fmtCount(refused)} ${refused === 1 ? 'needs' : 'need'} you`);
  if (resolved) parts.push(`${fmtCount(resolved)} resolved`);

  const head = canvases > 0 ? `${plural(canvases, 'canvas', 'es')} affected` : 'Nothing failing';
  return parts.length ? `${head} · ${parts.join(' · ')}.` : `${unpunctuated(head)}.`;
}
